import { Module } from "@nestjs/common";
import { RoundsModule } from "../rounds/rounds.module";
import { WalletsModule } from "../wallets/wallets.module";
import { EntriesService } from "./entries.service";

@Module({
  imports: [RoundsModule, WalletsModule],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
