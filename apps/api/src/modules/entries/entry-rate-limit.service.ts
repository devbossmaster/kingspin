import {
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from "@nestjs/common";
import { RealtimeMetricsService } from "../redis/realtime-metrics.service";
import { RedisService } from "../redis/redis.service";

type EntryRateLimitArgs = {
  userId: string;
  roomId: string;
  idempotencyKey?: string | null;
};

type LocalBucket = {
  count: number;
  resetAt: number;
};

const ENTRY_RATE_LIMIT_WINDOW_MS = 2_000;
const ENTRY_RATE_LIMIT_MAX_ATTEMPTS = 3;

@Injectable()
export class EntryRateLimitService {
  private readonly buckets = new Map<string, LocalBucket>();
  private readonly idempotencyKeys = new Map<string, number>();

  constructor(
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly metrics?: RealtimeMetricsService,
  ) {}

  async assertAllowed(args: EntryRateLimitArgs) {
    if (!args.userId || !args.roomId) {
      return;
    }

    if (this.redisService?.isAvailable()) {
      await this.assertAllowedWithRedis(args);
      return;
    }

    this.assertAllowedInMemory(args);
  }

  private async assertAllowedWithRedis(args: EntryRateLimitArgs) {
    const duplicateReplay = await this.markIdempotencyReplay(args);

    if (duplicateReplay) {
      return;
    }

    const count = await this.redisService?.incr(
      this.getBucketKey(args),
      ENTRY_RATE_LIMIT_WINDOW_MS,
    );

    if (count && count > ENTRY_RATE_LIMIT_MAX_ATTEMPTS) {
      this.metrics?.increment("entryRateLimitedCount");
      throw this.toRateLimitError();
    }
  }

  private async markIdempotencyReplay(args: EntryRateLimitArgs) {
    if (!args.idempotencyKey) {
      return false;
    }

    const key = this.getIdempotencyKey(args);
    const existing = await this.redisService?.get(key);

    if (existing) {
      return true;
    }

    await this.redisService?.set(key, "1", ENTRY_RATE_LIMIT_WINDOW_MS);
    return false;
  }

  private assertAllowedInMemory(args: EntryRateLimitArgs) {
    const now = Date.now();
    this.pruneExpired(now);

    if (args.idempotencyKey) {
      const key = this.getIdempotencyKey(args);
      const expiresAt = this.idempotencyKeys.get(key);

      if (expiresAt && expiresAt > now) {
        return;
      }

      this.idempotencyKeys.set(key, now + ENTRY_RATE_LIMIT_WINDOW_MS);
    }

    const key = this.getBucketKey(args);
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + ENTRY_RATE_LIMIT_WINDOW_MS,
      });
      return;
    }

    bucket.count += 1;

    if (bucket.count > ENTRY_RATE_LIMIT_MAX_ATTEMPTS) {
      this.metrics?.increment("entryRateLimitedCount");
      throw this.toRateLimitError();
    }
  }

  private getBucketKey(args: EntryRateLimitArgs) {
    return `entry-rate:${args.roomId}:${args.userId}`;
  }

  private getIdempotencyKey(args: EntryRateLimitArgs) {
    return `entry-rate:idempotency:${args.roomId}:${args.userId}:${args.idempotencyKey}`;
  }

  private toRateLimitError() {
    return new HttpException(
      {
        message: "Too many entry attempts. Please wait a moment and try again.",
        error: "Too Many Requests",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private pruneExpired(now: number) {
    if (this.buckets.size > 10_000) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) {
          this.buckets.delete(key);
        }
      }
    }

    if (this.idempotencyKeys.size > 10_000) {
      for (const [key, expiresAt] of this.idempotencyKeys) {
        if (expiresAt <= now) {
          this.idempotencyKeys.delete(key);
        }
      }
    }
  }
}
