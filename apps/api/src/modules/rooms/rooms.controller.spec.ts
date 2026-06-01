import { RoomStatus, RoundStatus } from '@kingspin/db';
import { RoomsController } from './rooms.controller';

describe('RoomsController', () => {
  it('fire-and-forget requests machine catch-up for overdue permanent OPEN rooms', async () => {
    const rooms = [
      {
        id: 'room-1',
        status: RoomStatus.ACTIVE,
        isPermanent: true,
        currentRound: {
          id: 'round-1',
          status: RoundStatus.OPEN,
          msUntilLock: 0,
          entryCount: 0,
        },
      },
      {
        id: 'room-2',
        status: RoomStatus.ACTIVE,
        isPermanent: true,
        currentRound: {
          id: 'round-2',
          status: RoundStatus.OPEN,
          msUntilLock: 1_000,
          entryCount: 0,
        },
      },
    ];
    const roomsService = {
      findActiveByCategorySlug: jest.fn().mockResolvedValue(rooms),
      getRoomState: jest.fn(),
    };
    const roundMachineService = {
      requestRoomCatchUp: jest.fn(),
      requestExpiredEmptyOpenRoundCatchUp: jest.fn(),
    };
    const controller = new RoomsController(
      roomsService as any,
      roundMachineService as any,
    );

    const result = await controller.findLiveByCategory('pro-10-100');

    expect(result).toBe(rooms);
    expect(
      roundMachineService.requestExpiredEmptyOpenRoundCatchUp,
    ).toHaveBeenCalledWith(
      'room-1',
      'round-1',
      'ROOMS_LIVE_OVERDUE_OPEN',
    );
    expect(
      roundMachineService.requestExpiredEmptyOpenRoundCatchUp,
    ).toHaveBeenCalledTimes(1);
    expect(roundMachineService.requestRoomCatchUp).not.toHaveBeenCalled();
  });
});
