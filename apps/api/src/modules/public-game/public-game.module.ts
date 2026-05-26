import { Module } from "@nestjs/common";
import { RoundsModule } from "../rounds/rounds.module";
import { PublicGameController } from "./public-game.controller";
import { PublicGameService } from "./public-game.service";

@Module({
  imports: [RoundsModule],
  controllers: [PublicGameController],
  providers: [PublicGameService],
})
export class PublicGameModule {}
