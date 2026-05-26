import { Controller, Get, Param } from "@nestjs/common";
import { RoundsService } from "./rounds.service";

@Controller("rooms/:roomId/rounds")
export class RoundsController {
  constructor(private readonly roundsService: RoundsService) {}

  @Get("latest-result")
  latestResult(@Param("roomId") roomId: string) {
    return this.roundsService.getLatestRoundResultForRoom(roomId);
  }
}
