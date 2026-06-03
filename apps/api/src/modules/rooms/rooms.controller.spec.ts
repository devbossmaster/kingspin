import { RoomStatus, RoundStatus } from '@kingspin/db';
import { RoomsController } from './rooms.controller';

describe('RoomsController', () => {
  it('catches up overdue permanent OPEN rooms and returns a refreshed summary', async () => {
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
        id: 'room-3',
        status: RoomStatus.ACTIVE,
        isPermanent: true,
        currentRound: {
          id: 'round-3',
          status: RoundStatus.OPEN,
          msUntilLock: 0,
          entryCount: 2,
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
    const refreshedRooms = [
      {
        id: 'room-1',
        status: RoomStatus.ACTIVE,
        isPermanent: true,
        currentRound: {
          id: 'round-new',
          status: RoundStatus.OPEN,
          msUntilLock: 45_000,
          entryCount: 0,
        },
      },
    ];
    const roomsService = {
      findActiveByCategorySlug: jest
        .fn()
        .mockResolvedValueOnce(rooms)
        .mockResolvedValueOnce(refreshedRooms),
      invalidateLiveRoomSummariesForCategory: jest.fn(),
      getRoomState: jest.fn(),
    };
    const roundMachineService = {
      requestRoomCatchUp: jest.fn(),
      requestExpiredEmptyOpenRoundCatchUp: jest.fn(),
      catchUpExpiredEmptyOpenRound: jest.fn().mockResolvedValue({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
      }),
      catchUpRoomMachine: jest.fn().mockResolvedValue({
        action: 'LOCKED_ROUND',
      }),
    };
    const controller = new RoomsController(
      roomsService as any,
      roundMachineService as any,
    );

    const result = await controller.findLiveByCategory('pro-10-100');

    expect(result).toBe(refreshedRooms);
    expect(
      roundMachineService.catchUpExpiredEmptyOpenRound,
    ).toHaveBeenCalledWith('room-1', 'round-1', 'ROOMS_LIVE_OVERDUE_OPEN');
    expect(
      roundMachineService.catchUpExpiredEmptyOpenRound,
    ).toHaveBeenCalledTimes(1);
    expect(roundMachineService.catchUpRoomMachine).toHaveBeenCalledWith(
      'room-3',
      'ROOMS_LIVE_OVERDUE_OPEN',
    );
    expect(roundMachineService.catchUpRoomMachine).toHaveBeenCalledTimes(1);
    expect(
      roomsService.invalidateLiveRoomSummariesForCategory,
    ).toHaveBeenCalledWith('pro-10-100');
    expect(roomsService.findActiveByCategorySlug).toHaveBeenCalledTimes(2);
    expect(roundMachineService.requestRoomCatchUp).not.toHaveBeenCalled();
    expect(
      roundMachineService.requestExpiredEmptyOpenRoundCatchUp,
    ).not.toHaveBeenCalled();
  });
});
