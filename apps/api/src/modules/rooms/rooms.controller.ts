import {
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Query,
  forwardRef,
} from '@nestjs/common';
import { RoundMachineService } from '../rounds/round-machine.service';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  private readonly logger = new Logger(RoomsController.name);

  constructor(
    private readonly roomsService: RoomsService,
    @Inject(forwardRef(() => RoundMachineService))
    private readonly roundMachineService: RoundMachineService,
  ) {}

  @Get()
  async findByCategory(@Query('categorySlug') categorySlug: string) {
    const rooms =
      await this.roomsService.findActiveByCategorySlug(categorySlug);

    return this.catchUpOverduePermanentRoomsAndRefresh(categorySlug, rooms);
  }

  @Get('live')
  async findLiveByCategory(@Query('categorySlug') categorySlug: string) {
    const rooms =
      await this.roomsService.findActiveByCategorySlug(categorySlug);

    return this.catchUpOverduePermanentRoomsAndRefresh(categorySlug, rooms);
  }

  @Get(':roomId/state')
  getState(@Param('roomId') roomId: string) {
    return this.roomsService.getRoomState(roomId);
  }

  private async catchUpOverduePermanentRoomsAndRefresh(
    categorySlug: string,
    rooms: unknown[],
  ) {
    let shouldRefresh = false;

    for (const room of rooms) {
      if (!this.isOverduePermanentOpenRoom(room)) {
        continue;
      }

      shouldRefresh = true;

      try {
        if (room.currentRound.entryCount === 0) {
          await this.roundMachineService.catchUpExpiredEmptyOpenRound(
            room.id,
            room.currentRound.id,
            'ROOMS_LIVE_OVERDUE_OPEN',
          );
        } else {
          await this.roundMachineService.catchUpRoomMachine(
            room.id,
            'ROOMS_LIVE_OVERDUE_OPEN',
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown catch-up error';

        this.logger.warn(
          `Overdue room catch-up failed for ${room.id}: ${message}`,
        );
      }
    }

    if (!shouldRefresh) {
      return rooms;
    }

    this.roomsService.invalidateLiveRoomSummariesForCategory(categorySlug);

    return this.roomsService.findActiveByCategorySlug(categorySlug);
  }

  private isOverduePermanentOpenRoom(room: unknown): room is {
    id: string;
    currentRound: {
      id: string;
      status: string;
      msUntilLock: number;
      entryCount: number;
    };
  } {
    if (!room || typeof room !== 'object') {
      return false;
    }

    const candidate = room as {
      id?: unknown;
      isPermanent?: unknown;
      status?: unknown;
      currentRound?: {
        id?: unknown;
        status?: unknown;
        msUntilLock?: unknown;
        entryCount?: unknown;
      } | null;
    };

    return (
      typeof candidate.id === 'string' &&
      candidate.isPermanent === true &&
      candidate.status === 'ACTIVE' &&
      typeof candidate.currentRound?.id === 'string' &&
      candidate.currentRound?.status === 'OPEN' &&
      typeof candidate.currentRound?.msUntilLock === 'number' &&
      typeof candidate.currentRound?.entryCount === 'number' &&
      candidate.currentRound.msUntilLock <= 0
    );
  }
}
