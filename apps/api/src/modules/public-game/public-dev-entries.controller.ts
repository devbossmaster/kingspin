import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from "@nestjs/common";
import {
  DevPlaceEntrySchema,
  type DevPlaceEntryInput,
} from "@kingspin/contracts";
import { RoomGateway } from "../../gateways/room.gateway";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import { EntriesService } from "../entries/entries.service";

@Controller("rooms/:roomId/entries")
export class PublicDevEntriesController {
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
    this.assertDevEndpointAllowed();

    const result = await this.entriesService.devPlaceEntryForRoom(roomId, body);

    await this.roomGateway.broadcastRoundState(
      roomId,
      result.reused ? "ENTRY_REUSED" : "ENTRY_PLACED",
    );

    return result;
  }

  private assertDevEndpointAllowed() {
    const isProduction = process.env.NODE_ENV === "production";
    const explicitlyAllowed =
      process.env.ALLOW_PUBLIC_DEV_ENTRY_ENDPOINT === "true";

    if (isProduction && !explicitlyAllowed) {
      throw new BadRequestException(
        "Public dev entry endpoint is disabled in production.",
      );
    }
  }
}
