import { Injectable, Logger, Optional } from '@nestjs/common';
import { getApiEnv } from '../../config/api-env';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeMetricsService } from '../redis/realtime-metrics.service';
import { RedisService } from '../redis/redis.service';

export type RoundMachineLockSkipReason =
  | 'PROCESS_LOCKED'
  | 'DATABASE_LOCKED'
  | 'REDIS_LOCKED';

export type RoundMachineLockResult<T> =
  | {
      acquired: true;
      result: T;
    }
  | {
      acquired: false;
      reason: RoundMachineLockSkipReason;
    };

@Injectable()
export class RoundMachineLockService {
  private readonly logger = new Logger(RoundMachineLockService.name);
  private readonly activeRooms = new Set<string>();
  private hasLoggedProductionPolicy = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly metrics?: RealtimeMetricsService,
  ) {}

  getLeadershipSnapshot() {
    const env = getApiEnv();
    const redisAvailable = this.redisService?.isAvailable() === true;

    return {
      mode: redisAvailable ? 'redis' : 'process',
      redisRequired: env.APP_ENV === 'production',
      redisAvailable,
      processLockedRooms: this.activeRooms.size,
    };
  }

  async withRoomTickLock<T>(
    roomId: string,
    work: () => Promise<T>,
  ): Promise<RoundMachineLockResult<T>> {
    if (this.activeRooms.has(roomId)) {
      return {
        acquired: false,
        reason: 'PROCESS_LOCKED',
      };
    }

    this.activeRooms.add(roomId);

    try {
      this.logProductionPolicy();

      /**
       * Important speed fix:
       *
       * Do not hold a PostgreSQL transaction open around the whole round-machine
       * work loop. Under Supabase pooler load, that can starve normal requests
       * like POST /entries and /me/wallet.
       *
       * For the current single-process/dev setup, the in-process room lock is
       * the fast path. Production horizontal scaling should use Redis locking or
       * a proper DB lease table, not a long advisory transaction lock.
       */
      const redisLock = await this.tryAcquireRedisLeadership(roomId);

      if (this.redisService?.isAvailable() && !redisLock) {
        this.metrics?.increment('redisLockContentionCount');
        return {
          acquired: false,
          reason: 'REDIS_LOCKED',
        };
      }

      const shouldUseDatabaseLeadership =
        !redisLock && this.shouldUseDatabaseLeadership();

      try {
        if (shouldUseDatabaseLeadership) {
          const acquiredDatabaseLeadership =
            await this.tryAcquireDatabaseLeadership(roomId);

          if (!acquiredDatabaseLeadership) {
            return {
              acquired: false,
              reason: 'DATABASE_LOCKED',
            };
          }
        }

        return {
          acquired: true,
          result: await work(),
        };
      } finally {
        if (redisLock) {
          await this.redisService?.releaseLock(redisLock);
        }
      }
    } finally {
      this.activeRooms.delete(roomId);
    }
  }

  private async tryAcquireRedisLeadership(roomId: string) {
    const env = getApiEnv();

    if (!this.redisService?.isAvailable()) {
      if (env.APP_ENV === 'production') {
        throw new Error(
          'Round machine Redis locking is required in production before horizontal scaling.',
        );
      }

      return null;
    }

    const lock = await this.redisService.acquireLock(
      `round-machine:${roomId}`,
      20_000,
    );

    if (lock) {
      this.metrics?.increment('redisLockAcquiredCount');
    }

    return lock;
  }

  private shouldUseDatabaseLeadership() {
    const env = getApiEnv();

    /**
     * Keep local/dev fast. Supabase pooler pressure is currently hurting the
     * player entry path more than this advisory check helps.
     */
    if (env.APP_ENV !== 'production') {
      return false;
    }

    /**
     * Redis is the production distributed leadership path. The database
     * advisory helper is kept as a reviewed fallback hook, but it should not
     * hold a transaction around the full machine tick.
     */
    return false;
  }

  private async tryAcquireDatabaseLeadership(roomId: string): Promise<boolean> {
    const lockKey = `round-machine:${roomId}`;

    try {
      const lockResult = await this.prisma.$queryRaw<
        Array<{ locked: boolean }>
      >`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint)::boolean AS locked
      `;

      return lockResult[0]?.locked === true;
    } catch (error) {
      const env = getApiEnv();
      const message =
        error instanceof Error ? error.message : 'Unknown advisory lock error';

      this.logger.warn(
        `Round machine advisory leadership unavailable for room ${roomId}; skipping DB leadership in ${env.APP_ENV}: ${message}`,
      );

      return false;
    }
  }

  private logProductionPolicy() {
    const env = getApiEnv();

    if (env.APP_ENV !== 'production' || this.hasLoggedProductionPolicy) {
      return;
    }

    this.hasLoggedProductionPolicy = true;

    this.logger.warn(
      'Round machine requires Redis locking before production horizontal scaling. Set ENABLE_REDIS=true and REDIS_URL for distributed leadership.',
    );
  }
}
