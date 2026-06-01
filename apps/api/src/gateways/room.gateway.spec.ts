import { WsException } from '@nestjs/websockets';
import { SOCKET_EVENTS } from '@kingspin/contracts';
import { GameMode, RoomStatus, RoundStatus } from '@kingspin/db';
import { RoomGateway } from './room.gateway';

const now = new Date('2026-05-26T12:00:00.000Z');

function buildRoom() {
  return {
    id: 'room-1',
    categoryId: 'category-1',
    code: 'room-one',
    name: 'Room One',
    status: RoomStatus.ACTIVE,
    isPermanent: true,
    maxPlayers: 20,
    roundDurationMs: 45_000,
    gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
    fixedEntryAmount: null,
    activatedAt: now,
    category: {
      id: 'category-1',
      name: 'Starter',
      slug: 'starter',
      minEntryAmount: 1_000n,
      maxEntryAmount: 5_000n,
      maxPlayers: 20,
      roundDurationMs: 45_000,
    },
  };
}

function buildRound() {
  return {
    id: 'round-1',
    roomId: 'room-1',
    roundNumber: 1,
    status: RoundStatus.OPEN,
    totalEntryAmount: 0n,
    houseFeeAmount: 0n,
    payoutAmount: 0n,
    openedAt: now,
    locksAt: new Date('2026-05-26T12:00:45.000Z'),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    serverSeedHash: 'hash',
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
  };
}

function buildPublicGameService() {
  const room = buildRoom();
  const round = buildRound();

  return {
    getRoomLiveState: jest.fn().mockResolvedValue({
      serverNow: now.toISOString(),
      room: {
        id: room.id,
        categoryId: room.categoryId,
        code: room.code,
        name: room.name,
        status: room.status,
        isPermanent: room.isPermanent,
        maxPlayers: room.maxPlayers,
        roundDurationMs: room.roundDurationMs,
        gameMode: room.gameMode,
        fixedEntryAmount: room.fixedEntryAmount,
        activatedAt: room.activatedAt.toISOString(),
      },
      category: {
        id: room.category.id,
        name: room.category.name,
        slug: room.category.slug,
        minEntryAmount: room.category.minEntryAmount.toString(),
        maxEntryAmount: room.category.maxEntryAmount.toString(),
        maxPlayers: room.category.maxPlayers,
        roundDurationMs: room.category.roundDurationMs,
      },
      currentRound: {
        id: round.id,
        roomId: round.roomId,
        roundNumber: round.roundNumber,
        status: round.status,
        phase: 'ENTRY_OPEN',
        phaseLabel: 'ENTRY OPEN',
        totalEntryAmount: round.totalEntryAmount.toString(),
        houseFeeAmount: round.houseFeeAmount.toString(),
        payoutAmount: round.payoutAmount.toString(),
        openedAt: round.openedAt.toISOString(),
        locksAt: round.locksAt?.toISOString() ?? null,
        lockedAt: null,
        drawingAt: null,
        spinningAt: null,
        settlingAt: null,
        completedAt: null,
        cancelledAt: null,
        serverSeedHash: round.serverSeedHash,
        winningTicket: null,
        winnerUserId: null,
        winnerEntryId: null,
        spinAngle: null,
        msUntilLock: 45_000,
        msUntilPhaseEnd: 45_000,
        msUntilNextRound: null,
        resultReason: null,
      },
      entries: [],
    }),
    invalidateRoomLiveState: jest.fn(),
  };
}

function buildRoomsService() {
  const room = buildRoom();
  const round = buildRound();

  return {
    findCategorySlugForRoom: jest.fn().mockResolvedValue(null),
    invalidateLiveRoomSummariesForCategory: jest.fn(),
    patchLiveRoomSummaryCacheWithOpenRound: jest.fn().mockReturnValue(false),
    findActiveByCategorySlug: jest.fn().mockResolvedValue([
      {
        id: room.id,
        categoryId: room.categoryId,
        categorySlug: room.category.slug,
        categoryName: room.category.name,
        code: room.code,
        name: room.name,
        status: room.status,
        gameMode: room.gameMode,
        fixedEntryAmount: null,
        isPermanent: room.isPermanent,
        maxPlayers: room.maxPlayers,
        roundDurationMs: room.roundDurationMs,
        activatedAt: room.activatedAt.toISOString(),
        serverNow: now.toISOString(),
        currentRound: {
          id: round.id,
          roundNumber: round.roundNumber,
          status: round.status,
          phase: 'ENTRY_OPEN',
          phaseLabel: 'ENTRY OPEN',
          locksAt: round.locksAt?.toISOString() ?? null,
          msUntilLock: 45_000,
          msUntilPhaseEnd: 45_000,
          msUntilNextRound: null,
          resultReason: null,
          playerCount: 0,
          entryCount: 0,
          totalEntryAmount: '0',
          payoutAmount: '0',
          totalPool: '0',
          winnerEntryId: null,
        },
      },
    ]),
  };
}

function buildClient() {
  const roomEmitter = {
    emit: jest.fn(),
  };
  const client = {
    id: 'socket-1',
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue(roomEmitter),
  };

  return { client, roomEmitter };
}

describe('RoomGateway', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('validates room:join, joins the socket room, and emits round:state', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const publicGameService = buildPublicGameService();
    const gateway = new RoomGateway(
      publicGameService as any,
      buildRoomsService() as any,
    );
    const { client, roomEmitter } = buildClient();

    const ack = await gateway.handleJoin(client as any, { roomId: 'room-1' });

    expect(client.join).toHaveBeenCalledWith('room-1');
    expect(client.join.mock.invocationCallOrder[0]).toBeLessThan(
      publicGameService.getRoomLiveState.mock.invocationCallOrder[0],
    );
    expect(client.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_STATE,
      expect.objectContaining({
        roomId: 'room-1',
        reason: 'JOINED_ROOM',
        snapshot: expect.objectContaining({
          currentRound: expect.objectContaining({
            id: 'round-1',
            msUntilLock: 45_000,
          }),
        }),
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROOM_PLAYER_JOINED,
      expect.objectContaining({
        roomId: 'room-1',
        socketId: 'socket-1',
      }),
    );
    expect(publicGameService.getRoomLiveState).toHaveBeenCalledWith('room-1');
    expect(ack).toEqual(
      expect.objectContaining({
        ok: true,
        roomId: 'room-1',
      }),
    );
  });

  it('rejects invalid room:join payloads before touching the database', async () => {
    const publicGameService = buildPublicGameService();
    const gateway = new RoomGateway(
      publicGameService as any,
      buildRoomsService() as any,
    );
    const { client } = buildClient();

    await expect(gateway.handleJoin(client as any, {})).rejects.toBeInstanceOf(
      WsException,
    );

    expect(publicGameService.getRoomLiveState).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('validates category:join, joins the category channel, and emits category:state', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const roomsService = buildRoomsService();
    const gateway = new RoomGateway(
      buildPublicGameService() as any,
      roomsService as any,
    );
    const { client } = buildClient();

    const ack = await gateway.handleCategoryJoin(client as any, {
      categorySlug: 'starter',
    });

    expect(client.join).toHaveBeenCalledWith('category:starter');
    expect(roomsService.findActiveByCategorySlug).toHaveBeenCalledWith(
      'starter',
    );
    expect(client.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.CATEGORY_STATE,
      expect.objectContaining({
        categorySlug: 'starter',
        reason: 'JOINED_CATEGORY',
        rooms: expect.arrayContaining([
          expect.objectContaining({ id: 'room-1' }),
        ]),
      }),
    );
    expect(ack).toEqual(
      expect.objectContaining({
        ok: true,
        categorySlug: 'starter',
      }),
    );
  });

  it('handles room:leave safely and emits player-left presence', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const gateway = new RoomGateway(
      buildPublicGameService() as any,
      buildRoomsService() as any,
    );
    const { client, roomEmitter } = buildClient();

    const ack = await gateway.handleLeave(client as any, { roomId: 'room-1' });

    expect(client.leave).toHaveBeenCalledWith('room-1');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROOM_PLAYER_LEFT,
      expect.objectContaining({
        roomId: 'room-1',
        socketId: 'socket-1',
        leftAt: now.toISOString(),
      }),
    );
    expect(ack).toEqual({
      ok: true,
      roomId: 'room-1',
      leftAt: now.toISOString(),
    });
  });

  it('broadcasts round lifecycle events with contract event names', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const gateway = new RoomGateway(
      buildPublicGameService() as any,
      buildRoomsService() as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    } as any;

    await gateway.broadcastMachineResult('room-1', {
      action: 'LOCKED_ROUND',
      resultId: 1n,
    });
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(150);

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_STATE,
      expect.objectContaining({
        roomId: 'room-1',
        reason: 'LOCKED_ROUND',
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_LOCKED,
      expect.objectContaining({
        roomId: 'room-1',
        action: 'LOCKED_ROUND',
        result: expect.objectContaining({
          resultId: '1',
        }),
      }),
    );
  });

  it('broadcasts canonical round state for settlement phase transitions', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const gateway = new RoomGateway(
      buildPublicGameService() as any,
      buildRoomsService() as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    } as any;

    await gateway.broadcastMachineResult('room-1', {
      action: 'STARTED_SETTLING_ROUND',
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_STATE,
      expect.objectContaining({
        roomId: 'room-1',
        reason: 'STARTED_SETTLING_ROUND',
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_SETTLED,
      expect.objectContaining({
        roomId: 'room-1',
        action: 'STARTED_SETTLING_ROUND',
      }),
    );

    roomEmitter.emit.mockClear();

    await gateway.broadcastMachineResult('room-1', {
      action: 'SETTLED_ROUND',
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_STATE,
      expect.objectContaining({
        roomId: 'room-1',
        reason: 'SETTLED_ROUND',
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_SETTLED,
      expect.objectContaining({
        roomId: 'room-1',
        action: 'SETTLED_ROUND',
      }),
    );
  });

  it('coalesces multiple room state broadcasts into one snapshot', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const publicGameService = buildPublicGameService();
    const gateway = new RoomGateway(
      publicGameService as any,
      buildRoomsService() as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    } as any;

    const first = gateway.broadcastRoundState('room-1', 'ENTRY_PLACED');
    const second = gateway.broadcastRoundState('room-1', 'ENTRY_PLACED');

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    await Promise.all([first, second]);

    expect(publicGameService.invalidateRoomLiveState).toHaveBeenCalledWith(
      'room-1',
    );
    expect(publicGameService.getRoomLiveState).toHaveBeenCalledTimes(1);
    expect(roomEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('skips room snapshot building when a room has no socket observers', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const publicGameService = buildPublicGameService();
    const roomsService = buildRoomsService();
    const gateway = new RoomGateway(
      publicGameService as any,
      roomsService as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      sockets: {
        adapter: {
          rooms: new Map(),
        },
      },
    } as any;

    const broadcast = gateway.broadcastRoundState('room-1', 'ENTRY_PLACED');

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    await broadcast;

    expect(publicGameService.invalidateRoomLiveState).toHaveBeenCalledWith(
      'room-1',
    );
    expect(publicGameService.getRoomLiveState).not.toHaveBeenCalled();
    expect(roomEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not rebuild category summaries for machine lifecycle broadcasts', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const publicGameService = buildPublicGameService();
    const roomsService = buildRoomsService();
    const gateway = new RoomGateway(
      publicGameService as any,
      roomsService as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      sockets: {
        adapter: {
          rooms: new Map([['room-1', new Set(['socket-1'])]]),
        },
      },
    } as any;

    const broadcast = gateway.broadcastRoundState('room-1', 'MACHINE_STARTED');

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    await broadcast;

    expect(publicGameService.invalidateRoomLiveState).not.toHaveBeenCalled();
    expect(roomsService.findCategorySlugForRoom).not.toHaveBeenCalled();
    expect(roomsService.findActiveByCategorySlug).not.toHaveBeenCalled();
    expect(publicGameService.getRoomLiveState).toHaveBeenCalledWith('room-1');
  });

  it('broadcasts category room summaries after a room state change', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const publicGameService = buildPublicGameService();
    const roomsService = buildRoomsService();

    roomsService.findCategorySlugForRoom.mockResolvedValue('starter');

    const gateway = new RoomGateway(
      publicGameService as any,
      roomsService as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    } as any;

    const broadcast = gateway.broadcastRoundState('room-1', 'ENTRY_PLACED');

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    await broadcast;
    await jest.advanceTimersByTimeAsync(50);

    expect(
      roomsService.invalidateLiveRoomSummariesForCategory,
    ).toHaveBeenCalledWith('starter');
    expect(roomsService.findActiveByCategorySlug).toHaveBeenCalledWith(
      'starter',
    );
    expect(gateway.server.to).toHaveBeenCalledWith('category:starter');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.CATEGORY_STATE,
      expect.objectContaining({
        categorySlug: 'starter',
        reason: 'ENTRY_PLACED',
      }),
    );
  });

  it('broadcasts category summaries after a skip/cancel machine result starts the next round', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const publicGameService = buildPublicGameService();
    const roomsService = buildRoomsService();

    roomsService.findCategorySlugForRoom.mockResolvedValue('starter');
    roomsService.patchLiveRoomSummaryCacheWithOpenRound.mockReturnValue(true);

    const gateway = new RoomGateway(
      publicGameService as any,
      roomsService as any,
    );
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    } as any;

    await gateway.broadcastMachineResult('room-1', {
      action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
      currentRound: {
        id: 'round-2',
        roomId: 'room-1',
        roundNumber: 2,
        status: RoundStatus.OPEN,
        totalEntryAmount: '0',
        houseFeeAmount: '0',
        payoutAmount: '0',
        openedAt: now.toISOString(),
        locksAt: new Date('2026-05-26T12:00:45.000Z').toISOString(),
        lockedAt: null,
        drawingAt: null,
        spinningAt: null,
        settlingAt: null,
        completedAt: null,
        cancelledAt: null,
        serverSeedHash: 'hash-2',
        winningTicket: null,
        winnerUserId: null,
        winnerEntryId: null,
        spinAngle: null,
      },
    });

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);
    await jest.advanceTimersByTimeAsync(50);

    expect(publicGameService.invalidateRoomLiveState).not.toHaveBeenCalled();
    expect(publicGameService.getRoomLiveState).not.toHaveBeenCalled();
    expect(
      roomsService.patchLiveRoomSummaryCacheWithOpenRound,
    ).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        id: 'round-2',
        status: RoundStatus.OPEN,
      }),
    );
    expect(
      roomsService.invalidateLiveRoomSummariesForCategory,
    ).not.toHaveBeenCalled();
    expect(roomsService.findActiveByCategorySlug).toHaveBeenCalledWith(
      'starter',
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.CATEGORY_STATE,
      expect.objectContaining({
        categorySlug: 'starter',
        reason: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
      }),
    );
  });
});
