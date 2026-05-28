import { Injectable, Logger } from "@nestjs/common";
import { getApiEnv } from "../../config/api-env";
import { PrismaService } from "../../prisma/prisma.service";

export type RoundMachineLockSkipReason =
  | "PROCESS_LOCKED"
  | "DATABASE_LOCKED";

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

  constructor(private readonly prisma: PrismaService) {}

  async withRoomTickLock<T>(
    roomId: string,
    work: () => Promise<T>,
  ): Promise<RoundMachineLockResult<T>> {
    if (this.activeRooms.has(roomId)) {
      return {
        acquired: false,
        reason: "PROCESS_LOCKED",
      };
    }

    this.activeRooms.add(roomId);

    try {
      this.logProductionPolicy();

      const acquiredDatabaseLeadership =
        await this.tryAcquireDatabaseLeadership(roomId);

      if (!acquiredDatabaseLeadership) {
        return {
          acquired: false,
          reason: "DATABASE_LOCKED",
        };
      }

      return {
        acquired: true,
        result: await work(),
      };
    } finally {
      this.activeRooms.delete(roomId);
    }
  }

  private async tryAcquireDatabaseLeadership(
    roomId: string,
  ): Promise<boolean> {
    const lockKey = `round-machine:${roomId}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint)::boolean AS locked
        `;

        return lockResult[0]?.locked === true;
      });
    } catch (error) {
      const env = getApiEnv();
      const message =
        error instanceof Error ? error.message : "Unknown advisory lock error";

      if (env.APP_ENV !== "local") {
        this.logger.error(
          `Round machine advisory leadership check failed in ${env.APP_ENV} for room ${roomId}: ${message}`,
        );
        throw error;
      }

      this.logger.warn(
        `Round machine advisory leadership check unavailable for room ${roomId}; using process-only lock in ${env.APP_ENV}: ${message}`,
      );

      return true;
    }
  }

  private logProductionPolicy() {
    const env = getApiEnv();

    if (env.APP_ENV !== "production" || this.hasLoggedProductionPolicy) {
      return;
    }

    this.hasLoggedProductionPolicy = true;

    if (!env.ENABLE_REDIS) {
      this.logger.warn(
        "Production round machine is using PostgreSQL advisory locks. Configure Redis locks/adapter before horizontal scaling.",
      );
      return;
    }

    this.logger.warn(
      "ENABLE_REDIS=true, but Redis round-machine locking is not wired yet. PostgreSQL advisory locks remain the active safety layer.",
    );
  }
}
