import { Controller, Get, Param } from "@nestjs/common";
import { PublicGameService } from "./public-game.service";

@Controller("rooms/:roomId")
export class PublicGameController {
  constructor(private readonly publicGameService: PublicGameService) {}

  @Get("live-state")
  liveState(@Param("roomId") roomId: string) {
    return this.publicGameService.getRoomLiveState(roomId);
  }
}
