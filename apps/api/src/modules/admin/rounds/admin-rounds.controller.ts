import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { RoundsService } from "../../rounds/rounds.service";

@Controller("admin/rooms/:roomId/rounds")
@UseGuards(AdminDevGuard)
export class AdminRoundsController {
  constructor(private readonly roundsService: RoundsService) {}

  @Post("start")
  startRound(@Param("roomId") roomId: string) {
    return this.roundsService.startOpenRoundForRoom(roomId);
  }

  @Post("lock-current")
  lockCurrentRound(@Param("roomId") roomId: string) {
    return this.roundsService.lockCurrentRoundForRoom(roomId);
  }

  @Post("draw-current")
  drawCurrentRound(@Param("roomId") roomId: string) {
    return this.roundsService.drawCurrentRoundForRoom(roomId);
  }

  @Post("settle-current")
  settleCurrentRound(@Param("roomId") roomId: string) {
    return this.roundsService.settleCurrentRoundForRoom(roomId);
  }

  @Post("cancel-current")
  cancelCurrentRound(@Param("roomId") roomId: string) {
    return this.roundsService.cancelCurrentRoundForRoom(roomId);
  }

  @Get("latest-result")
  latestResult(@Param("roomId") roomId: string) {
    return this.roundsService.getLatestRoundResultForRoom(roomId);
  }
}
