import {
  Body,
  Controller,
  Logger,
  Param,
  Post,
  Optional,
  UseGuards,
} from '@nestjs/common';
import { PlaceEntrySchema, type PlaceEntryInput } from '@kingspin/contracts';
import { RoomGateway } from '../../gateways/room.gateway';
import { AuthGuard } from '../auth-bridge/auth.guard';
import { CurrentUser } from '../auth-bridge/current-user.decorator';
import type { AuthBridgeUser } from '../auth-bridge/auth.types';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { EntryRateLimitService } from './entry-rate-limit.service';
import { EntriesService } from './entries.service';

@Controller('rooms/:roomId/entries')
export class EntriesController {
  private readonly logger = new Logger(EntriesController.name);

  constructor(
    private readonly entriesService: EntriesService,
    private readonly roomGateway: RoomGateway,
    @Optional() private readonly entryRateLimitService?: EntryRateLimitService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  async placeEntry(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthBridgeUser,
    @Body(new ZodValidationPipe(PlaceEntrySchema)) body: PlaceEntryInput,
  ) {
    await this.entryRateLimitService?.assertAllowed({
      roomId,
      userId: user.id,
      idempotencyKey: body.idempotencyKey,
    });

    const result = await this.entriesService.placeEntryForUser({
      roomId,
      userId: user.id,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
    });

    const eventType = result.reused ? 'ENTRY_REUSED' : 'ENTRY_PLACED';

    this.roomGateway.invalidateRoomState(roomId);

    /**
     * Important performance fix:
     *
     * Do NOT await broadcastRoundState() in the HTTP request path.
     *
     * The entry has already been written by entriesService.placeEntryForUser().
     * The response already contains enough data for the frontend to update quickly.
     * Waiting for the socket broadcast forces POST /entries to also pay the cost of
     * rebuilding and emitting the full room snapshot.
     */
    setImmediate(() => {
      void this.roomGateway
        .broadcastRoundState(roomId, eventType)
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to broadcast round state after ${eventType} for room ${roomId}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
    });

    return result;
  }
}
