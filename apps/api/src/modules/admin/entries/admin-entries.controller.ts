import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { RoomGateway } from "../../../gateways/room.gateway";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { EntriesService } from "../../entries/entries.service";

type DevPlaceEntryRequestBody = {
  userId?: unknown;
  playerKey?: unknown;
  amount?: unknown;
  idempotencyKey?: unknown;
};

@Controller("admin/rooms/:roomId/entries")
@UseGuards(AdminDevGuard)
export class AdminEntriesController {
  constructor(
    private readonly entriesService: EntriesService,
    private readonly roomGateway: RoomGateway,
  ) {}

  @Post("dev-place")
  async devPlaceEntry(
    @Param("roomId") roomId: string,
    @Body() body: DevPlaceEntryRequestBody,
  ) {
    const result = await this.entriesService.devPlaceEntryForRoom(roomId, body);

    await this.roomGateway.broadcastRoundState(roomId, "ENTRY_PLACED");

    return result;
  }
}
