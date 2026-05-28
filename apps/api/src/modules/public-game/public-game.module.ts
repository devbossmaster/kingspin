import { Module } from "@nestjs/common";
import { PublicGameController } from "./public-game.controller";
import { PublicGameService } from "./public-game.service";

@Module({
  controllers: [PublicGameController],
  providers: [PublicGameService],
  exports: [PublicGameService],
})
export class PublicGameModule {}
