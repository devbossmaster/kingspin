import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { PlaceEntrySchema, type PlaceEntryInput } from "@kingspin/contracts";
import { RoomGateway } from "../../gateways/room.gateway";
import { AuthGuard } from "../auth-bridge/auth.guard";
import { CurrentUser } from "../auth-bridge/current-user.decorator";
import type { AuthBridgeUser } from "../auth-bridge/auth.types";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import { EntriesService } from "./entries.service";

@Controller("rooms/:roomId/entries")
export class EntriesController {
  constructor(
    private readonly entriesService: EntriesService,
    private readonly roomGateway: RoomGateway,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  async placeEntry(
    @Param("roomId") roomId: string,
    @CurrentUser() user: AuthBridgeUser,
    @Body(new ZodValidationPipe(PlaceEntrySchema)) body: PlaceEntryInput,
  ) {
    const result = await this.entriesService.placeEntryForUser({
      roomId,
      userId: user.id,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
    });

    await this.roomGateway.broadcastRoundState(
      roomId,
      result.reused ? "ENTRY_REUSED" : "ENTRY_PLACED",
    );

    return result;
  }
}
