import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { RealtimeMetricsService } from "../redis/realtime-metrics.service";
import { RedisService } from "../redis/redis.service";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly realtimeMetrics: RealtimeMetricsService,
  ) {}

  getHealth() {
    return {
      status: "ok",
      service: "kingspin-api",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async getDbHealth() {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: "ok",
        service: "kingspin-api",
        database: {
          status: "ok",
          latencyMs: Date.now() - startedAt,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        message: "Database health check failed.",
        error: "Service Unavailable",
        database: {
          status: "unavailable",
          latencyMs: Date.now() - startedAt,
        },
      });
    }
  }

  async getRedisHealth() {
    return {
      status: "ok",
      service: "kingspin-api",
      redis: await this.redisService.ping(),
      timestamp: new Date().toISOString(),
    };
  }

  async getRealtimeHealth() {
    return {
      status: "ok",
      service: "kingspin-api",
      redis: await this.redisService.ping(),
      metrics: this.realtimeMetrics.snapshot(),
      timestamp: new Date().toISOString(),
    };
  }
}
