import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../auth-bridge/auth-bridge.module";
import { FraudModule } from "../fraud/fraud.module";
import { WalletTransfersController } from "./wallet-transfers.controller";
import { WalletTransfersService } from "./wallet-transfers.service";
import { WalletsService } from "./wallets.service";

@Module({
  imports: [AuthBridgeModule, FraudModule],
  controllers: [WalletTransfersController],
  providers: [WalletsService, WalletTransfersService],
  exports: [WalletsService, WalletTransfersService],
})
export class WalletsModule {}
