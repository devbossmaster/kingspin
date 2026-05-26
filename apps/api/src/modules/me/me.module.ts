import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../auth-bridge/auth-bridge.module";
import { WalletsModule } from "../wallets/wallets.module";
import { MeController } from "./me.controller";

@Module({
  imports: [AuthBridgeModule, WalletsModule],
  controllers: [MeController],
})
export class MeModule {}
