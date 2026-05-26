import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { RoundMachineService } from "../../rounds/round-machine.service";

@Controller("admin/rooms/:roomId/machine")
@UseGuards(AdminDevGuard)
export class AdminRoundMachineController {
  constructor(private readonly roundMachineService: RoundMachineService) {}

  @Post("start")
  start(@Param("roomId") roomId: string) {
    return this.roundMachineService.startRoomMachine(roomId);
  }

  @Post("stop")
  stop(@Param("roomId") roomId: string) {
    return this.roundMachineService.stopRoomMachine(roomId);
  }

  @Get("status")
  status(@Param("roomId") roomId: string) {
    return this.roundMachineService.getRoomMachineStatus(roomId);
  }

  @Post("advance-once")
  advanceOnce(
    @Param("roomId") roomId: string,
    @Query("force") force?: string,
  ) {
    return this.roundMachineService.advanceRoomOnce(roomId, {
      force: force === "true",
    });
  }
}
