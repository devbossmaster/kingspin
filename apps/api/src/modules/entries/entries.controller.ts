import {
  Body,
  Controller,
  Logger,
  Param,
  Post,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PlaceEntrySchema, type PlaceEntryInput } from '@kingspin/contracts';
import { createHash } from 'node:crypto';
import { RoomGateway } from '../../gateways/room.gateway';
import { AuthGuard } from '../auth-bridge/auth.guard';
import { CurrentUser } from '../auth-bridge/current-user.decorator';
import type { AuthBridgeUser } from '../auth-bridge/auth.types';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { EntryRateLimitService } from './entry-rate-limit.service';
import { EntriesService } from './entries.service';

const ENTRY_BROADCAST_SCHEDULE_WARN_THRESHOLD_MS = 300;
const ENTRY_HTTP_WARN_THRESHOLD_MS = 300;

type EntryHttpRequest = {
  requestId?: string;
};

function hashUserId(userId: string) {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

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
    @Req() request?: EntryHttpRequest,
  ) {
    const requestReceivedAtMs = Date.now();
    const requestId = request?.requestId;
    const hashedUserId = hashUserId(user.id);
    const events: string[] = [];
    let status = 'ERROR';
    let eventType = 'ENTRY_FAILED';
    let roundId = 'unknown';
    const record = (label: string, startedAt: number) => {
      events.push(`${label}=${Date.now() - startedAt}ms`);
    };
    const logIfSlow = () => {
      const totalMs = Date.now() - requestReceivedAtMs;

      if (totalMs < ENTRY_HTTP_WARN_THRESHOLD_MS) {
        return;
      }

      this.logger.warn(
        [
          '[entry-http] slow POST /entries',
          `requestId=${requestId ?? 'none'}`,
          `roomId=${roomId}`,
          `roundId=${roundId}`,
          `user=${hashedUserId}`,
          `amount=${String(body.amount)}`,
          `status=${status}`,
          `event=${eventType}`,
          `total=${totalMs}ms`,
          `events=${events.join('; ')}`,
        ].join(' '),
      );
    };

    try {
      const rateLimitStartedAt = Date.now();
      await this.entryRateLimitService?.assertAllowed({
        roomId,
        userId: user.id,
        idempotencyKey: body.idempotencyKey,
      });
      record('rate-limit', rateLimitStartedAt);

      const serviceStartedAt = Date.now();
      const result = await this.entriesService.placeEntryForUser({
        roomId,
        userId: user.id,
        amount: body.amount,
        idempotencyKey: body.idempotencyKey,
        requestId,
        requestReceivedAtMs,
      });
      record('entry-service', serviceStartedAt);

      status = result.reused ? 'REPLAY' : 'SUCCESS';
      roundId = result.currentRound?.id ?? roundId;
      eventType = result.reused ? 'ENTRY_REUSED' : 'ENTRY_PLACED';

      const broadcastScheduleStartedAt = Date.now();

      this.roomGateway.invalidateRoomState(roomId);

      /**
       * Do not await the live-state rebuild or Socket.IO emit in the entry
       * response path. The response carries the user's confirmed entry/wallet;
       * the socket catches up the full room view.
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

      const broadcastScheduleMs = Date.now() - broadcastScheduleStartedAt;
      events.push(`post-commit-broadcast-schedule=${broadcastScheduleMs}ms`);

      if (broadcastScheduleMs >= ENTRY_BROADCAST_SCHEDULE_WARN_THRESHOLD_MS) {
        this.logger.warn(
          `Slow entry broadcast scheduling room=${roomId} event=${eventType} duration=${broadcastScheduleMs}ms`,
        );
      }

      logIfSlow();

      return result;
    } catch (error) {
      status = error instanceof Error ? error.constructor.name : 'ERROR';
      logIfSlow();
      throw error;
    }
  }
}
