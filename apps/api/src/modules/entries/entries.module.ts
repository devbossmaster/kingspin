import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../auth-bridge/auth-bridge.module";
import { RoundsModule } from "../rounds/rounds.module";
import { WalletsModule } from "../wallets/wallets.module";
import { EntriesController } from "./entries.controller";
import { EntryRateLimitService } from "./entry-rate-limit.service";
import { EntriesService } from "./entries.service";

@Module({
  imports: [AuthBridgeModule, RoundsModule, WalletsModule],
  controllers: [EntriesController],
  providers: [EntriesService, EntryRateLimitService],
  exports: [EntriesService],
})
export class EntriesModule {}
