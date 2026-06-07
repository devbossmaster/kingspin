import { Controller, Get, Param, Query } from '@nestjs/common';
import { RoomGateway } from '../../gateways/room.gateway';
import { RoundsService } from './rounds.service';

type WinnerFeedScope = 'latest' | 'week' | 'month';

function parseWinnerFeedScope(value: string | undefined): WinnerFeedScope {
  return value === 'week' || value === 'month' ? value : 'latest';
}

function parseWinnerFeedLimit(value: string | undefined) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 15;
}

@Controller('rooms')
export class WinnerFeedController {
  constructor(private readonly roundsService: RoundsService) {}

  @Get('winners')
  winners(@Query('scope') scope?: string, @Query('limit') limit?: string) {
    return this.roundsService.getPublicWinnerFeed(
      parseWinnerFeedScope(scope),
      parseWinnerFeedLimit(limit),
    );
  }
}

@Controller('rooms')
export class RoomPresenceController {
  constructor(private readonly roomGateway: RoomGateway) {}

  @Get('online')
  online() {
    return this.roomGateway.getSpinBattleOnlinePresence();
  }
}

@Controller('rooms/:roomId/rounds')
export class RoundsController {
  constructor(private readonly roundsService: RoundsService) {}

  @Get('latest-result')
  latestResult(@Param('roomId') roomId: string) {
    return this.roundsService.getLatestRoundResultForRoom(roomId);
  }
}
