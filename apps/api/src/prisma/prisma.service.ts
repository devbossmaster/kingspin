import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@kingspin/db";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      /**
       * Important for Supabase pooler / real-time workload stability:
       *
       * Prisma's default interactive transaction wait/timeout can be too tight
       * when the API, round-machine, live-state broadcasts, and wallet writes
       * compete for pooled connections.
       *
       * Service-level transactions can still override these values, but this
       * gives every transaction a safer baseline.
       */
      transactionOptions: {
        maxWait: 5_000,
        timeout: 10_000,
      },

      /**
       * Keep production errors compact. Development keeps readable stack/errors.
       */
      errorFormat: process.env.NODE_ENV === "production" ? "minimal" : "pretty",
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
