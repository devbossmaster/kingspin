import { Module } from "@nestjs/common";
import { WalletsModule } from "../../wallets/wallets.module";
import { AdminWalletsController } from "./admin-wallets.controller";

@Module({
  imports: [WalletsModule],
  controllers: [AdminWalletsController],
})
export class AdminWalletsModule {}
