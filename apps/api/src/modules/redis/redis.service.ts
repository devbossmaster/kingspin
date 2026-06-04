import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { getApiEnv } from '../../config/api-env';

export type RedisDedicatedClient = RedisClientType;
type RedisClient = RedisDedicatedClient;

export type RedisLock = {
  key: string;
  value: string;
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly env = getApiEnv();
  private readonly subscribers = new Set<RedisClient>();
  private client: RedisClient | null = null;
  private connectPromise: Promise<RedisClient | null> | null = null;

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    const clients = [
      ...this.subscribers,
      ...(this.client ? [this.client] : []),
    ];

    await Promise.allSettled(
      clients.map((client) =>
        client.isOpen ? client.quit() : Promise.resolve(),
      ),
    );

    this.subscribers.clear();
    this.client = null;
    this.connectPromise = null;
  }

  isEnabled() {
    return this.env.ENABLE_REDIS === true;
  }

  isAvailable() {
    return this.client?.isReady === true;
  }

  async ping() {
    const client = await this.getClient();

    if (!client) {
      return {
        enabled: this.isEnabled(),
        available: false,
        latencyMs: null,
      };
    }

    const startedAt = Date.now();
    await client.ping();

    return {
      enabled: true,
      available: true,
      latencyMs: Date.now() - startedAt,
    };
  }

  async get(key: string) {
    const client = await this.getClient();
    return client ? client.get(key) : null;
  }

  async set(key: string, value: string, ttlMs?: number) {
    const client = await this.getClient();

    if (!client) {
      return false;
    }

    if (ttlMs && ttlMs > 0) {
      await client.set(key, value, { PX: ttlMs });
    } else {
      await client.set(key, value);
    }

    return true;
  }

  async del(key: string) {
    const client = await this.getClient();
    return client ? client.del(key) : 0;
  }

  async incr(key: string, ttlMs?: number) {
    if (ttlMs && ttlMs > 0) {
      const result = await this.incrementWithTtl(key, ttlMs);
      return result?.count ?? null;
    }

    const client = await this.getClient();

    if (!client) {
      return null;
    }

    return client.incr(key);
  }

  async incrementWithTtl(key: string, ttlMs: number) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('Redis increment TTL must be a positive safe integer.');
    }

    const client = await this.getClient();

    if (!client) {
      return null;
    }

    const result = await client.eval(
      `
local ttl = tonumber(ARGV[1])
if not ttl or ttl <= 0 then
  return redis.error_reply('ttl must be positive')
end
local count = redis.call('INCR', KEYS[1])
local remaining = redis.call('PTTL', KEYS[1])
if remaining < 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  remaining = ttl
end
return { count, remaining }
      `,
      {
        keys: [key],
        arguments: [ttlMs.toString()],
      },
    );

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis increment returned an invalid response.');
    }

    const count = this.toNumber(result[0]);
    const remainingTtlMs = this.toNumber(result[1]);

    if (!Number.isFinite(count) || !Number.isFinite(remainingTtlMs)) {
      throw new Error('Redis increment returned non-numeric values.');
    }

    return {
      count,
      ttlMs: Math.max(0, remainingTtlMs),
    };
  }

  async publish(channel: string, message: string) {
    const client = await this.getClient();
    return client ? client.publish(channel, message) : 0;
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void | Promise<void>,
  ) {
    if (!this.isEnabled()) {
      return () => Promise.resolve(undefined);
    }

    const subscriber = await this.createDedicatedClient(
      `subscriber:${channel}`,
    );

    if (!subscriber) {
      return () => Promise.resolve(undefined);
    }

    await subscriber.subscribe(channel, (message) => {
      void Promise.resolve(handler(message)).catch((error: unknown) => {
        const detail =
          error instanceof Error ? error.message : 'Unknown subscriber error';
        this.logger.warn(`Redis subscriber handler failed: ${detail}`);
      });
    });

    this.subscribers.add(subscriber);

    return async () => {
      await Promise.allSettled([subscriber.unsubscribe(channel)]);
      this.subscribers.delete(subscriber);
      if (subscriber.isOpen) {
        await subscriber.quit();
      }
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<RedisLock | null> {
    const client = await this.getClient();

    if (!client) {
      return null;
    }

    const value = `${process.pid}:${randomUUID()}`;
    const result = await client.set(key, value, {
      NX: true,
      PX: ttlMs,
    });

    return result === 'OK' ? { key, value } : null;
  }

  async releaseLock(lock: RedisLock) {
    const client = await this.getClient();

    if (!client) {
      return false;
    }

    const result = await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      {
        keys: [lock.key],
        arguments: [lock.value],
      },
    );

    return result === 1;
  }

  async createDedicatedClient(label: string): Promise<RedisClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.env.REDIS_URL) {
      this.handleUnavailable(
        `Redis ${label} client requested but REDIS_URL is missing.`,
      );
      return null;
    }

    const client = createClient({ url: this.env.REDIS_URL }) as RedisClient;

    client.on('error', (error: Error) => {
      this.logger.error(`Redis ${label} client error: ${error.message}`);
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis connect error';

      await Promise.allSettled([
        client.isOpen ? client.quit() : Promise.resolve(),
      ]);

      this.handleUnavailable(
        `Redis ${label} client unavailable: ${message}`,
        error,
      );

      return null;
    }
  }

  private async getClient(): Promise<RedisClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (this.client?.isReady) {
      return this.client;
    }

    return this.connect();
  }

  private async connect(): Promise<RedisClient | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.env.REDIS_URL) {
      this.handleUnavailable('ENABLE_REDIS=true but REDIS_URL is missing.');
      return null;
    }

    if (this.client?.isReady) {
      return this.client;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connectFreshClient();

    return this.connectPromise;
  }

  private async connectFreshClient(): Promise<RedisClient | null> {
    const client = createClient({ url: this.env.REDIS_URL }) as RedisClient;

    client.on('error', (error: Error) => {
      this.logger.error(`Redis client error: ${error.message}`);
    });

    try {
      await client.connect();
      this.client = client;
      this.logger.log(
        'Redis connected for realtime cache, locks, and rate limits.',
      );
      return client;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis connect error';

      await Promise.allSettled([
        client.isOpen ? client.quit() : Promise.resolve(),
      ]);

      this.client = null;
      this.connectPromise = null;
      this.handleUnavailable(`Redis unavailable: ${message}`, error);
      return null;
    }
  }

  private handleUnavailable(message: string, error?: unknown) {
    if (this.env.APP_ENV === 'production') {
      this.logger.error(message);

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(message);
    }

    this.logger.warn(
      `${message} Continuing without Redis in ${this.env.APP_ENV}.`,
    );
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'bigint') {
      return Number(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return Number(value);
    }

    return Number.NaN;
  }
}
