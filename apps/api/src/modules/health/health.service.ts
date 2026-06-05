import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RealtimeMetricsService } from '../redis/realtime-metrics.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getApiEnv } from '../../config/api-env';
import { RoundMachineService } from '../rounds/round-machine.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly realtimeMetrics: RealtimeMetricsService,
    private readonly roundMachineService: RoundMachineService,
  ) {}

  getHealth() {
    return {
      status: 'ok',
      service: 'kingspin-api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async getDbHealth() {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        service: 'kingspin-api',
        database: {
          status: 'ok',
          latencyMs: Date.now() - startedAt,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        message: 'Database health check failed.',
        error: 'Service Unavailable',
        database: {
          status: 'unavailable',
          latencyMs: Date.now() - startedAt,
        },
      });
    }
  }

  async getRedisHealth() {
    return {
      status: 'ok',
      service: 'kingspin-api',
      redis: await this.redisService.ping(),
      timestamp: new Date().toISOString(),
    };
  }

  async getRealtimeHealth() {
    return {
      status: 'ok',
      service: 'kingspin-api',
      redis: await this.redisService.ping(),
      metrics: this.realtimeMetrics.snapshot(),
      timestamp: new Date().toISOString(),
    };
  }

  async getRoundMachineHealth() {
    const startedAt = Date.now();
    let database = {
      status: 'unavailable',
      latencyMs: 0,
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = {
        status: 'ok',
        latencyMs: Date.now() - startedAt,
      };

      const [redis, roundMachine] = await Promise.all([
        this.redisService.ping(),
        this.roundMachineService.getRoundMachineHealthSnapshot({
          logWarnings: true,
        }),
      ]);

      return {
        status: this.getRoundMachineOverallStatus(roundMachine, redis),
        service: 'kingspin-api',
        database,
        redis,
        roundMachine,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        message: 'Round machine health check failed.',
        error: 'Service Unavailable',
        database: {
          status: database.status === 'ok' ? 'ok' : 'unavailable',
          latencyMs: Date.now() - startedAt,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private getRoundMachineOverallStatus(
    roundMachine: Awaited<
      ReturnType<RoundMachineService['getRoundMachineHealthSnapshot']>
    >,
    redis: Awaited<ReturnType<RedisService['ping']>>,
  ) {
    const env = getApiEnv();
    const productionRedisUnavailable =
      env.APP_ENV === 'production' && redis.available !== true;
    const productionAutoStartDisabled =
      env.APP_ENV === 'production' && roundMachine.enabled !== true;
    const expectedMachineNotRunning =
      roundMachine.enabled === true &&
      roundMachine.rooms.activePermanent > 0 &&
      roundMachine.rooms.runningPermanent === 0;
    const staleRounds =
      roundMachine.staleRounds.staleCompletedOrCurrent > 0 ||
      roundMachine.staleRounds.warnings > 0;

    return productionRedisUnavailable ||
      productionAutoStartDisabled ||
      expectedMachineNotRunning ||
      staleRounds
      ? 'degraded'
      : 'ok';
  }
}
