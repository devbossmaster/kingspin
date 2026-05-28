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

  private readonly transactionOptions = {
    maxWait: 2_000,
    timeout: 15_000,
  } as const;

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

      return await this.runWithDatabaseLeadership(roomId, work);
    } finally {
      this.activeRooms.delete(roomId);
    }
  }

  private async runWithDatabaseLeadership<T>(
    roomId: string,
    work: () => Promise<T>,
  ): Promise<RoundMachineLockResult<T>> {
    const lockKey = `round-machine:${roomId}`;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
            SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint)::boolean AS locked
          `;

          const locked = lockResult[0]?.locked === true;

          if (!locked) {
            return {
              acquired: false,
              reason: "DATABASE_LOCKED" as const,
            };
          }

          /**
           * Important correctness fix:
           *
           * pg_try_advisory_xact_lock is held only until this transaction ends.
           * Therefore work() must run before this transaction returns.
           *
           * The old code acquired the xact lock inside a tiny transaction, ended
           * that transaction, released the lock, and only then ran work().
           */
          const result = await work();

          return {
            acquired: true,
            result,
          };
        },
        this.transactionOptions,
      );
    } catch (error) {
      const env = getApiEnv();
      const message =
        error instanceof Error ? error.message : "Unknown advisory lock error";

      /**
       * In local development, keep the app usable even if Postgres advisory locks
       * are unavailable.
       */
      if (env.APP_ENV === "local") {
        this.logger.warn(
          `Round machine advisory leadership unavailable for room ${roomId}; using process-only lock in ${env.APP_ENV}: ${message}`,
        );

        return {
          acquired: true,
          result: await work(),
        };
      }

      /**
       * In deployed environments, do not crash the round-machine loop just
       * because Supabase pooler could not start this tiny transaction. Skip this
       * tick and try again on the next scheduler pass.
       *
       * This directly addresses noisy logs like:
       * "Unable to start a transaction."
       */
      this.logger.warn(
        `Round machine skipped tick for room ${roomId}; advisory leadership transaction unavailable in ${env.APP_ENV}: ${message}`,
      );

      return {
        acquired: false,
        reason: "DATABASE_LOCKED",
      };
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
        "Production round machine is using PostgreSQL advisory transaction locks. Configure Redis locks/adapter before horizontal scaling.",
      );
      return;
    }

    this.logger.warn(
      "ENABLE_REDIS=true, but Redis round-machine locking is not wired yet. PostgreSQL advisory transaction locks remain the active safety layer.",
    );
  }
}
