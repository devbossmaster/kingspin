import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { EntriesService } from "../../entries/entries.service";

type DevPlaceEntryRequestBody = {
  userId?: unknown;
  playerKey?: unknown;
  amount?: unknown;
};

@Controller("admin/rooms/:roomId/entries")
@UseGuards(AdminDevGuard)
export class AdminEntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Post("dev-place")
  devPlaceEntry(
    @Param("roomId") roomId: string,
    @Body() body: DevPlaceEntryRequestBody,
  ) {
    return this.entriesService.devPlaceEntryForRoom(roomId, body);
  }
}
