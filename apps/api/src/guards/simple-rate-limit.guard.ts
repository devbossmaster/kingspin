import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  name: string;
  methods?: string[];
  pattern: RegExp;
  windowMs: number;
  maxRequests: number;
};

type SimpleRateLimitOptions = {
  defaultWindowMs: number;
  defaultMaxRequests: number;
  isProduction: boolean;
  trustProxyHeaders: boolean;
  appEnv?: string;
  allowInMemoryFallback?: boolean;
  redis?: RateLimitRedisClient;
};

type RateLimitRedisClient = {
  isEnabled: () => boolean;
  incrementWithTtl: (
    key: string,
    ttlMs: number,
  ) => Promise<{ count: number; ttlMs: number } | null>;
};

@Injectable()
export class SimpleRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(SimpleRateLimitGuard.name);
  private readonly buckets = new Map<string, Bucket>();
  private readonly rules: RateLimitRule[];
  private readonly defaultRule: RateLimitRule;
  private loggedRedisFallback = false;

  constructor(private readonly options: SimpleRateLimitOptions) {
    this.defaultRule = {
      name: 'default',
      pattern: /.*/,
      windowMs: options.defaultWindowMs,
      maxRequests: options.defaultMaxRequests,
    };

    this.rules = [
      {
        name: 'entry-place',
        methods: ['POST'],
        pattern: /^\/rooms\/[^/]+\/entries\/?$/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 240 : 600,
      },
      {
        name: 'wallet-transfer',
        methods: ['POST'],
        pattern: /^\/wallet\/transfers(?:\/resolve-recipient)?\/?$/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 20 : 60,
      },
      {
        name: 'public-live-state',
        methods: ['GET'],
        pattern: /^\/rooms\/[^/]+\/live-state\/?$/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 120 : 300,
      },
      {
        name: 'public-latest-result',
        methods: ['GET'],
        pattern: /^\/rooms\/[^/]+\/rounds\/latest-result\/?$/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 120 : 300,
      },
      {
        name: 'public-winners',
        methods: ['GET'],
        pattern: /^\/rooms\/winners\/?$/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 240 : 600,
      },
      {
        name: 'public-room-online',
        methods: ['GET'],
        pattern: /^\/rooms\/online\/?$/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 240 : 600,
      },
      {
        name: 'admin',
        pattern: /^\/admin(?:\/|$)/,
        windowMs: 60_000,
        maxRequests: options.isProduction ? 60 : 180,
      },
    ];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
    }>();
    const response = context.switchToHttp().getResponse<{
      setHeader?: (name: string, value: string | number) => void;
    }>();
    const rule = this.getRuleForRequest(request);
    const now = Date.now();
    const bucket = await this.incrementBucket(
      rule,
      this.getClientKey(request),
      now,
    );

    this.setRateLimitHeaders(response, rule, bucket);

    if (bucket.count > rule.maxRequests) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1_000);
      response.setHeader?.('Retry-After', Math.max(1, retryAfterSeconds));

      throw new HttpException(
        {
          message: 'Too many requests.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private async incrementBucket(
    rule: RateLimitRule,
    clientKey: string,
    now: number,
  ): Promise<Bucket> {
    const key = this.getStorageKey(rule.name, clientKey);

    if (this.options.redis?.isEnabled()) {
      try {
        const result = await this.options.redis.incrementWithTtl(
          key,
          rule.windowMs,
        );

        if (result) {
          return {
            count: result.count,
            resetAt: now + this.normalizeRedisTtl(result.ttlMs, rule.windowMs),
          };
        }
      } catch (error) {
        if (!this.canUseInMemoryFallback()) {
          throw this.toRedisUnavailableError(error);
        }

        this.logRedisFallback(error);
      }
    }

    if (!this.canUseInMemoryFallback()) {
      throw this.toRedisUnavailableError(
        new Error(
          'Global API rate limiter requires Redis outside local/test environments.',
        ),
      );
    }

    return this.incrementInMemory(key, rule, now);
  }

  private incrementInMemory(key: string, rule: RateLimitRule, now: number) {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const nextBucket = {
        count: 1,
        resetAt: now + rule.windowMs,
      };

      this.buckets.set(key, nextBucket);
      this.pruneExpiredBuckets(now);
      return nextBucket;
    }

    bucket.count += 1;
    return bucket;
  }

  private getStorageKey(routeKey: string, clientKey: string) {
    return `ratelimit:global:${routeKey}:${clientKey}`;
  }

  private normalizeRedisTtl(ttlMs: number, windowMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return windowMs;
    }

    return Math.min(ttlMs, windowMs);
  }

  private canUseInMemoryFallback() {
    if (typeof this.options.allowInMemoryFallback === 'boolean') {
      return this.options.allowInMemoryFallback;
    }

    return this.options.appEnv === 'local' || process.env.NODE_ENV === 'test';
  }

  private logRedisFallback(error: unknown) {
    if (this.loggedRedisFallback) {
      return;
    }

    this.loggedRedisFallback = true;
    const detail =
      error instanceof Error ? error.message : 'Unknown Redis rate-limit error';

    this.logger.warn(
      `Global API rate limiter is falling back to in-memory storage: ${detail}`,
    );
  }

  private toRedisUnavailableError(error: unknown) {
    const detail =
      error instanceof Error ? error.message : 'Unknown Redis rate-limit error';

    this.logger.error(
      `Global API rate limiter Redis storage unavailable: ${detail}`,
    );

    return new ServiceUnavailableException(
      'Global API rate limiter Redis storage is unavailable.',
    );
  }

  private getRuleForRequest(request: {
    method?: string;
    originalUrl?: string;
    url?: string;
  }) {
    const method = request.method?.toUpperCase();
    const path = this.normalizePath(request.originalUrl ?? request.url ?? '/');

    return (
      this.rules.find((rule) => {
        if (rule.methods && (!method || !rule.methods.includes(method))) {
          return false;
        }

        return rule.pattern.test(path);
      }) ?? this.defaultRule
    );
  }

  private getClientKey(request: {
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
  }) {
    if (this.options.trustProxyHeaders) {
      /**
       * Only enable TRUST_PROXY_HEADERS when the API is behind a trusted
       * reverse proxy such as Nginx, Coolify, or Cloudflare that overwrites
       * client-supplied forwarding headers.
       */
      const forwardedIp = this.getForwardedForClientIp(
        request.headers?.['x-forwarded-for'],
      );

      if (forwardedIp) {
        return forwardedIp;
      }
    }

    return (
      this.normalizeClientKey(request.ip) ??
      this.normalizeClientKey(request.socket?.remoteAddress) ??
      'unknown-client'
    );
  }

  private getForwardedForClientIp(value: string | string[] | undefined) {
    const forwardedFor = Array.isArray(value) ? value[0] : value;

    if (!forwardedFor) {
      return null;
    }

    const firstIp = forwardedFor
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.length > 0);

    return this.normalizeClientKey(firstIp);
  }

  private normalizeClientKey(value: string | undefined) {
    const normalized = value?.trim();

    return normalized && normalized.length > 0 ? normalized : null;
  }

  private normalizePath(path: string) {
    return path.split('?')[0] || '/';
  }

  private setRateLimitHeaders(
    response: { setHeader?: (name: string, value: string | number) => void },
    rule: RateLimitRule,
    bucket: Bucket,
  ) {
    const remaining = Math.max(0, rule.maxRequests - bucket.count);

    response.setHeader?.('X-RateLimit-Limit', rule.maxRequests);
    response.setHeader?.('X-RateLimit-Remaining', remaining);
    response.setHeader?.(
      'X-RateLimit-Reset',
      Math.ceil(bucket.resetAt / 1_000),
    );
  }

  private pruneExpiredBuckets(now: number) {
    if (this.buckets.size < 10_000) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
