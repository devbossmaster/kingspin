import { Module } from "@nestjs/common";
import { PublicGameController } from "./public-game.controller";
import { PublicGameService } from "./public-game.service";

@Module({
  controllers: [PublicGameController],
  providers: [PublicGameService],
})
export class PublicGameModule {}
