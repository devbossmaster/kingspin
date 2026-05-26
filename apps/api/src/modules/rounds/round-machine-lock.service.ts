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

      return await this.withPostgresAdvisoryLock(roomId, work);
    } finally {
      this.activeRooms.delete(roomId);
    }
  }

  private async withPostgresAdvisoryLock<T>(
    roomId: string,
    work: () => Promise<T>,
  ): Promise<RoundMachineLockResult<T>> {
    const lockKey = `round-machine:${roomId}`;
    let startedWork = false;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_lock(hashtext(${lockKey})::bigint)::boolean AS locked
        `;

        if (lockResult[0]?.locked !== true) {
          return {
            acquired: false,
            reason: "DATABASE_LOCKED",
          };
        }

        try {
          startedWork = true;
          const result = await work();

          return {
            acquired: true,
            result,
          };
        } finally {
          const unlockResult = await tx.$queryRaw<Array<{ unlocked: boolean }>>`
            SELECT pg_advisory_unlock(hashtext(${lockKey})::bigint)::boolean AS unlocked
          `;

          if (unlockResult[0]?.unlocked !== true) {
            this.logger.warn(
              `PostgreSQL advisory lock for room ${roomId} did not report a clean unlock.`,
            );
          }
        }
      });
    } catch (error) {
      if (startedWork) {
        throw error;
      }

      const env = getApiEnv();
      const message =
        error instanceof Error ? error.message : "Unknown advisory lock error";

      if (env.NODE_ENV === "production") {
        this.logger.error(
          `Round machine advisory lock failed in production for room ${roomId}: ${message}`,
        );
        throw error;
      }

      this.logger.warn(
        `Round machine advisory lock unavailable for room ${roomId}; using process-only lock in ${env.NODE_ENV}: ${message}`,
      );

      return {
        acquired: true,
        result: await work(),
      };
    }
  }

  private logProductionPolicy() {
    const env = getApiEnv();

    if (env.NODE_ENV !== "production" || this.hasLoggedProductionPolicy) {
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
