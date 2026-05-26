import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../auth-bridge/auth-bridge.module";
import { RoundsModule } from "../rounds/rounds.module";
import { WalletsModule } from "../wallets/wallets.module";
import { EntriesController } from "./entries.controller";
import { EntriesService } from "./entries.service";

@Module({
  imports: [AuthBridgeModule, RoundsModule, WalletsModule],
  controllers: [EntriesController],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
