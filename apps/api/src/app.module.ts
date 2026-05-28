import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { AdminEntriesModule } from "./modules/admin/entries/admin-entries.module";
import { AdminOperationsModule } from "./modules/admin/admin-operations.module";
import { AdminRoomsModule } from "./modules/admin/rooms/admin-rooms.module";
import { AdminRoundsModule } from "./modules/admin/rounds/admin-rounds.module";
import { AdminRoundMachineModule } from "./modules/admin/round-machine/admin-round-machine.module";
import { AdminWalletsModule } from "./modules/admin/wallets/admin-wallets.module";
import { AuthBridgeModule } from "./modules/auth-bridge/auth-bridge.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { EntriesModule } from "./modules/entries/entries.module";
import { FraudModule } from "./modules/fraud/fraud.module";
import { HealthModule } from "./modules/health/health.module";
import { MeModule } from "./modules/me/me.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { ReconciliationModule } from "./modules/reconciliation/reconciliation.module";
import { RoomsModule } from "./modules/rooms/rooms.module";
import { RoundsModule } from "./modules/rounds/rounds.module";
import { PublicGameModule } from "./modules/public-game/public-game.module";
import { RedisModule } from "./modules/redis/redis.module";
import { WalletsModule } from "./modules/wallets/wallets.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { validateAndStoreApiEnv } from "./config/api-env";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, "..", ".env"),
      validate: (config) =>
        validateAndStoreApiEnv(config as Record<string, string | undefined>),
    }),
    RedisModule,
    PrismaModule,
    AuthBridgeModule,
    AuditModule,
    FraudModule,
    ReconciliationModule,
    CategoriesModule,
    RoomsModule,
    RoundsModule,
    PublicGameModule,
    EntriesModule,
    HealthModule,
    MeModule,
    WalletsModule,
    PaymentsModule,
    AdminOperationsModule,
    AdminRoomsModule,
    AdminRoundsModule,
    AdminRoundMachineModule,
    AdminEntriesModule,
    AdminWalletsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}



