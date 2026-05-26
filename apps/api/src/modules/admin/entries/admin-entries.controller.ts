import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import {
  DevPlaceEntrySchema,
  type DevPlaceEntryInput,
} from "@kingspin/contracts";
import { RoomGateway } from "../../../gateways/room.gateway";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { ZodValidationPipe } from "../../../pipes/zod-validation.pipe";
import { EntriesService } from "../../entries/entries.service";

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
    @Body(new ZodValidationPipe(DevPlaceEntrySchema))
    body: DevPlaceEntryInput,
  ) {
    const result = await this.entriesService.devPlaceEntryForRoom(roomId, body);

    await this.roomGateway.broadcastRoundState(
      roomId,
      result.reused ? "ENTRY_REUSED" : "ENTRY_PLACED",
    );

    return result;
  }
}
