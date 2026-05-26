import { Module } from "@nestjs/common";
import { EntriesModule } from "../entries/entries.module";
import { RoundsModule } from "../rounds/rounds.module";
import { PublicDevEntriesController } from "./public-dev-entries.controller";
import { PublicDevWalletController } from "./public-dev-wallet.controller";
import { PublicGameController } from "./public-game.controller";
import { PublicGameService } from "./public-game.service";

@Module({
  imports: [EntriesModule, RoundsModule],
  controllers: [
    PublicGameController,
    PublicDevEntriesController,
    PublicDevWalletController,
  ],
  providers: [PublicGameService],
})
export class PublicGameModule {}
