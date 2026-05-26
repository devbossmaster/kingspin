import { Module } from "@nestjs/common";
import { WalletsModule } from "../wallets/wallets.module";
import { RoundsService } from "./rounds.service";

@Module({
  imports: [WalletsModule],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
