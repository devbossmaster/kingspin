import { ConflictException } from '@nestjs/common';
import { RoomStatus, RoundStatus } from '@kingspin/db';
import { resetApiEnvForTesting } from '../../config/api-env';
import { RoundMachineService } from './round-machine.service';

const now = new Date('2026-05-26T12:00:00.000Z');

function buildRound(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'round-1',
    roomId: 'room-1',
    roundNumber: 1,
    status: RoundStatus.OPEN,
    openedAt: now,
    locksAt: new Date('2026-05-26T11:59:00.000Z'),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    totalEntryAmount: 0n,
    houseFeeAmount: 0n,
    payoutAmount: 0n,
    serverSeedHash: 'hash',
    serverSeedReveal: null,
    fairnessAlgorithm: 'HMAC_SHA256_REJECTION_SAMPLING_V1',
    entriesHash: null,
    drawHash: null,
    drawNonce: null,
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
    idempotencyKey: 'round:start:room-1:1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildService(args?: {
  lockResult?: {
    acquired: false;
    reason: 'PROCESS_LOCKED' | 'DATABASE_LOCKED';
  };
  currentRound?: ReturnType<typeof buildRound> | null;
  latestRound?: ReturnType<typeof buildRound> | null;
  entryCount?: number;
  lockEvents?: string[];
}) {
  const prisma = {
    room: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'room-1',
        code: 'room-one',
        status: RoomStatus.ACTIVE,
        roundDurationMs: 45_000,
      }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn(),
    },
    round: {
      findFirst: jest.fn((query?: { where?: { status?: unknown } }) => {
        if (query?.where?.status) {
          return Promise.resolve(args?.currentRound ?? null);
        }

        return Promise.resolve(args?.latestRound ?? args?.currentRound ?? null);
      }),
    },
    entry: {
      count: jest.fn().mockResolvedValue(args?.entryCount ?? 0),
    },
  };

  const roundsService = {
    toRoundSnapshot: jest.fn((round) => ({
      id: round.id,
      status: round.status,
      locksAt: round.locksAt?.toISOString() ?? null,
    })),
    startOpenRoundForRoom: jest.fn().mockResolvedValue({
      id: 'round-new',
      status: RoundStatus.OPEN,
      locksAt: '2026-05-26T12:00:45.000Z',
    }),
    cancelCurrentRoundForRoom: jest.fn().mockResolvedValue({
      currentRound: {
        id: 'round-1',
        status: RoundStatus.CANCELLED,
      },
    }),
    cancelExpiredOpenRoundForRoom: jest.fn().mockResolvedValue({
      currentRound: {
        id: 'round-1',
        status: RoundStatus.CANCELLED,
      },
    }),
    cancelExpiredOpenRoundAndStartNextForRoom: jest.fn().mockResolvedValue({
      cancelledRound: {
        id: 'round-1',
        status: RoundStatus.CANCELLED,
      },
      currentRound: {
        id: 'round-new',
        status: RoundStatus.OPEN,
        locksAt: '2026-05-26T12:00:45.000Z',
      },
      refundSummary: {
        refundedCount: 0,
        skippedCount: 0,
        alreadyRefundedCount: 0,
        refundedAmount: '0',
      },
    }),
    cancelExpiredEmptyOpenRoundAndStartNextForRoom: jest
      .fn()
      .mockResolvedValue(null),
    cancelCurrentRoundAndStartNextForRoom: jest.fn().mockResolvedValue({
      cancelledRound: {
        id: 'round-1',
        status: RoundStatus.CANCELLED,
      },
      currentRound: {
        id: 'round-new',
        status: RoundStatus.OPEN,
        locksAt: '2026-05-26T12:00:45.000Z',
      },
      refundSummary: {
        refundedCount: 0,
        skippedCount: 0,
        alreadyRefundedCount: 0,
        refundedAmount: '0',
      },
    }),
    lockCurrentRoundForRoom: jest.fn(),
    drawCurrentRoundForRoom: jest.fn(),
    startSpinningCurrentRoundForRoom: jest.fn(),
    startSettlingCurrentRoundForRoom: jest.fn(),
    settleCurrentRoundForRoom: jest.fn(),
  };

  roundsService.lockCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: 'round-1',
      status: RoundStatus.LOCKED,
    },
  });
  roundsService.drawCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: 'round-1',
      status: RoundStatus.DRAWING,
    },
  });
  roundsService.startSpinningCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: 'round-1',
      status: RoundStatus.SPINNING,
    },
  });
  roundsService.startSettlingCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: 'round-1',
      status: RoundStatus.SETTLING,
    },
  });
  roundsService.settleCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: 'round-1',
      status: RoundStatus.COMPLETED,
    },
  });

  const roomGateway = {
    broadcastMachineResult: jest.fn().mockResolvedValue(undefined),
    broadcastRoundState: jest.fn().mockResolvedValue(undefined),
  };

  const roundMachineLockService = {
    getLeadershipSnapshot: jest.fn().mockReturnValue({
      mode: 'process',
      redisRequired: false,
      redisAvailable: false,
      processLockedRooms: 0,
    }),
    withRoomTickLock: jest.fn(
      async (_roomId: string, work: () => Promise<Record<string, unknown>>) => {
        if (args?.lockResult) {
          return args.lockResult;
        }

        args?.lockEvents?.push('lock:start');
        return {
          acquired: true,
          result: await work().finally(() => {
            args?.lockEvents?.push('lock:end');
          }),
        };
      },
    ),
  };

  return {
    service: new RoundMachineService(
      prisma as any,
      roundsService as any,
      roomGateway as any,
      roundMachineLockService as any,
    ),
    prisma,
    roundsService,
    roomGateway,
    roundMachineLockService,
  };
}

describe('RoundMachineService', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.ROUND_MACHINE_AUTO_START;
    delete process.env.APP_ENV;
    resetApiEnvForTesting();
  });

  it('does not auto-start machines unless ROUND_MACHINE_AUTO_START=true', () => {
    jest.useFakeTimers();
    process.env.APP_ENV = 'local';
    process.env.ROUND_MACHINE_AUTO_START = 'false';
    resetApiEnvForTesting();
    const { service, prisma } = buildService();

    service.onModuleInit();
    jest.advanceTimersByTime(2_000);

    expect(prisma.room.findMany).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('does not create duplicate timers when a running room is started again', async () => {
    jest.useFakeTimers();
    const futureOpenRound = buildRound({
      locksAt: new Date('2026-05-26T12:00:30.000Z'),
    });
    const { service, roomGateway } = buildService({
      currentRound: futureOpenRound,
    });

    await service.startRoomMachine('room-1');
    await service.startRoomMachine('room-1');

    expect(jest.getTimerCount()).toBe(1);
    expect(roomGateway.broadcastRoundState).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('starts the machine by immediately advancing an expired empty open round', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const expiredRound = buildRound();
    const { service, roundsService, roomGateway } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    const status = await service.startRoomMachine('room-1');

    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(roundsService.startOpenRoundForRoom).not.toHaveBeenCalled();
    expect(status).toEqual(
      expect.objectContaining({
        roomId: 'room-1',
        isRunning: true,
        tickCount: 1,
        lastAction: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        lastError: null,
        lastTickAt: now.toISOString(),
        nextTickAt: '2026-05-26T12:00:45.000Z',
      }),
    );
    expect(roomGateway.broadcastRoundState).not.toHaveBeenCalled();
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );

    service.onModuleDestroy();
  });

  it('auto-starts active permanent rooms once when ROUND_MACHINE_AUTO_START=true', async () => {
    jest.useFakeTimers();
    process.env.APP_ENV = 'local';
    process.env.ROUND_MACHINE_AUTO_START = 'true';
    resetApiEnvForTesting();
    const { service, prisma, roomGateway } = buildService();

    prisma.room.findMany.mockResolvedValueOnce([
      { id: 'room-1', code: 'PRO-A' },
      { id: 'room-2', code: 'PRO-B' },
    ]);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(prisma.room.findMany).toHaveBeenCalledWith({
      where: {
        status: RoomStatus.ACTIVE,
        isPermanent: true,
      },
      select: {
        id: true,
        code: true,
      },
      orderBy: { code: 'asc' },
    });
    expect(roomGateway.broadcastRoundState).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(2);

    await service.startRoomMachine('room-1');

    expect(roomGateway.broadcastRoundState).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(2);

    service.onModuleDestroy();
  });

  it('auto-starts many permanent rooms with bounded startup catch-up', async () => {
    const { service, prisma } = buildService();
    let releaseFirst!: () => void;
    const firstRoomBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const startedRooms: string[] = [];

    prisma.room.findMany.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_unused, index) => ({
        id: `room-${index + 1}`,
        code: `PRO-${index + 1}`,
      })),
    );
    jest
      .spyOn(service, 'startRoomMachine')
      .mockImplementation(async (roomId: string) => {
        startedRooms.push(roomId);

        if (roomId === 'room-1') {
          await firstRoomBlocked;
        }

        return {} as Awaited<
          ReturnType<RoundMachineService['startRoomMachine']>
        >;
      });

    const autoStart = (service as any).autoStartPermanentActiveRooms();
    await Promise.resolve();
    await Promise.resolve();

    expect(startedRooms).toEqual(['room-1', 'room-2']);

    releaseFirst();
    await autoStart;

    expect(startedRooms).toHaveLength(5);
    expect(new Set(startedRooms)).toEqual(
      new Set(['room-1', 'room-2', 'room-3', 'room-4', 'room-5']),
    );
  });

  it('coalesces fire-and-forget catch-up requests per room', async () => {
    const { service } = buildService();
    let releaseCatchUp!: () => void;
    const firstCatchUp = new Promise((resolve) => {
      releaseCatchUp = () => resolve({ action: 'NO_ACTION' });
    });
    const catchUpRoomMachine = jest
      .spyOn(service, 'catchUpRoomMachine')
      .mockReturnValue(firstCatchUp as any);

    service.requestRoomCatchUp('room-1', 'FIRST');
    service.requestRoomCatchUp('room-1', 'SECOND');

    expect(catchUpRoomMachine).toHaveBeenCalledTimes(1);
    expect(catchUpRoomMachine).toHaveBeenCalledWith('room-1', 'FIRST');

    releaseCatchUp();
    await firstCatchUp;
    await Promise.resolve();
    await Promise.resolve();

    service.requestRoomCatchUp('room-1', 'THIRD');

    expect(catchUpRoomMachine).toHaveBeenCalledTimes(2);
    expect(catchUpRoomMachine).toHaveBeenLastCalledWith('room-1', 'THIRD');
  });

  it('auto-starts a permanent expired open room without leaving it frozen', async () => {
    jest.useFakeTimers().setSystemTime(now);
    process.env.APP_ENV = 'local';
    process.env.ROUND_MACHINE_AUTO_START = 'true';
    resetApiEnvForTesting();
    const expiredRound = buildRound();
    const { service, prisma, roundsService, roomGateway } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    prisma.room.findMany.mockResolvedValueOnce([
      { id: 'room-1', code: 'PRO-A' },
    ]);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);

    const status = await service.getRoomMachineStatus('room-1');

    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(roundsService.startOpenRoundForRoom).not.toHaveBeenCalled();
    expect(status).toEqual(
      expect.objectContaining({
        isRunning: true,
        tickCount: 1,
        lastAction: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        lastError: null,
      }),
    );
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
      }),
    );

    service.onModuleDestroy();
  });

  it('reports and logs stale completed permanent rooms without opening rounds', async () => {
    jest.useFakeTimers().setSystemTime(now);
    process.env.APP_ENV = 'local';
    process.env.ROUND_MACHINE_AUTO_START = 'true';
    resetApiEnvForTesting();

    const staleCompletedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: new Date('2026-05-26T11:59:00.000Z'),
      locksAt: null,
    });
    const { service, prisma, roundsService } = buildService();
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    prisma.room.findMany.mockResolvedValueOnce([
      {
        id: 'room-1',
        code: 'PRO-A',
        rounds: [staleCompletedRound],
      },
    ]);

    const snapshot = await service.getRoundMachineHealthSnapshot({
      logWarnings: true,
    });

    expect(roundsService.startOpenRoundForRoom).not.toHaveBeenCalled();
    expect(snapshot).toEqual(
      expect.objectContaining({
        enabled: true,
        rooms: expect.objectContaining({
          active: 1,
          activePermanent: 1,
        }),
        staleRounds: expect.objectContaining({
          completedPastCooldown: 1,
          activePermanentRoomsStaleWithoutCurrentRound: 1,
          staleCompletedOrCurrent: 1,
        }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=COMPLETED_PAST_COOLDOWN'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=NO_CURRENT_ACTIVE_ROUND'),
    );

    warnSpy.mockRestore();
  });

  it('schedules an immediate follow-up when an OPEN deadline is already past', () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service } = buildService();

    expect(
      (service as any).getNextDelayMs({
        action: 'STARTED_OPEN_ROUND',
        currentRound: {
          locksAt: '2026-05-26T11:59:59.000Z',
        },
      }),
    ).toBe(0);
  });

  it('stops a running room machine without rebuilding live state', async () => {
    jest.useFakeTimers();
    const { service, roomGateway } = buildService();

    await service.startRoomMachine('room-1');
    await service.stopRoomMachine('room-1');

    expect(roomGateway.broadcastRoundState).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('returns a leader skip when the room lock is already owned', async () => {
    const { service, prisma } = buildService({
      lockResult: {
        acquired: false,
        reason: 'DATABASE_LOCKED',
      },
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(result).toEqual({
      action: 'SKIPPED_NOT_LEADER',
      roomId: 'room-1',
      message: 'Another process is advancing this room.',
      force: false,
    });
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it('starts an open round through the lock-protected machine path', async () => {
    const { service, roundMachineLockService, roundsService } = buildService();

    const result = await service.advanceRoomOnce('room-1');

    expect(roundMachineLockService.withRoomTickLock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith('room-1');
    expect(result).toEqual(
      expect.objectContaining({
        action: 'STARTED_OPEN_ROUND',
        roomId: 'room-1',
      }),
    );
  });

  it('treats a raced round start conflict as a leader skip', async () => {
    const { service, roundsService } = buildService();

    roundsService.startOpenRoundForRoom.mockRejectedValueOnce(
      new ConflictException('Another round start is already running.'),
    );

    const result = await service.advanceRoomOnce('room-1');

    expect(result).toEqual({
      action: 'SKIPPED_NOT_LEADER',
      roomId: 'room-1',
      message: 'Another process is advancing this room.',
      force: false,
    });
  });

  it('still cancels an expired empty round and opens the next round', async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(
      roundsService.cancelExpiredEmptyOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(roundsService.startOpenRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.lockCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
  });

  it('uses the fast empty-expired-open transition when the DB confirms zero entries', async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    roundsService.cancelExpiredEmptyOpenRoundAndStartNextForRoom.mockResolvedValueOnce(
      {
        cancelledRound: {
          id: 'round-1',
          status: RoundStatus.CANCELLED,
        },
        currentRound: {
          id: 'round-new',
          status: RoundStatus.OPEN,
          locksAt: '2026-05-26T12:00:45.000Z',
        },
        refundSummary: {
          refundedCount: 0,
          skippedCount: 0,
          alreadyRefundedCount: 0,
          refundedAmount: '0',
        },
      },
    );

    const result = await service.advanceRoomOnce('room-1');

    expect(
      roundsService.cancelExpiredEmptyOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
  });

  it('advances once through the machine status and broadcast path', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const expiredRound = buildRound();
    const { service, roundsService, roomGateway } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    const result = await service.advanceRoomMachineOnce('room-1');
    const status = await service.getRoomMachineStatus('room-1');

    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(roundsService.startOpenRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
    expect(status).toEqual(
      expect.objectContaining({
        isRunning: false,
        tickCount: 1,
        lastAction: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
        lastError: null,
        lastTickAt: now.toISOString(),
        nextTickAt: null,
      }),
    );
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT',
      }),
    );
  });

  it('refund-cancels an expired single-player round and opens the next round', async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 1,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1', 'round-1');
    expect(roundsService.startOpenRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.lockCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_SINGLE_PLAYER_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
  });

  it('locks an expired open round once it has at least two entries', async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 2,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.lockCurrentRoundForRoom).toHaveBeenCalledWith(
      'room-1',
    );
    expect(roundsService.cancelCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.cancelExpiredOpenRoundForRoom).not.toHaveBeenCalled();
    expect(
      roundsService.cancelExpiredOpenRoundAndStartNextForRoom,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'LOCKED_ROUND',
        roomId: 'room-1',
      }),
    );
  });

  it('draws after the locked phase elapses', async () => {
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const { service, roundsService } = buildService({
      currentRound: lockedRound,
      entryCount: 2,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.drawCurrentRoundForRoom).toHaveBeenCalledWith(
      'room-1',
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: 'DREW_ROUND',
        roomId: 'room-1',
      }),
    );
  });

  it('skips a stale locked round with no entries instead of drawing', async () => {
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const { service, roundsService } = buildService({
      currentRound: lockedRound,
      entryCount: 0,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(
      roundsService.cancelCurrentRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1');
    expect(roundsService.cancelCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_LOCKED_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
  });

  it('recovers a locked round with no entries before waiting for the locked phase', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: now,
    });
    const { service, roundsService } = buildService({
      currentRound: lockedRound,
      entryCount: 0,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(
      roundsService.cancelCurrentRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1');
    expect(roundsService.cancelCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_EMPTY_LOCKED_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
  });

  it('refund-skips a stale locked round with one entry instead of drawing', async () => {
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const { service, roundsService } = buildService({
      currentRound: lockedRound,
      entryCount: 1,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(
      roundsService.cancelCurrentRoundAndStartNextForRoom,
    ).toHaveBeenCalledWith('room-1');
    expect(roundsService.cancelCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'CANCELLED_SINGLE_PLAYER_LOCKED_ROUND_AND_STARTED_NEXT',
        roomId: 'room-1',
      }),
    );
  });

  it('starts spinning after the drawing phase elapses', async () => {
    const drawingRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: new Date('2026-05-26T11:59:00.000Z'),
      winningTicket: 10n,
      winnerEntryId: 'entry-1',
      winnerUserId: 'user-1',
      spinAngle: 42,
    });
    const { service, roundsService } = buildService({
      currentRound: drawingRound,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.startSpinningCurrentRoundForRoom).toHaveBeenCalledWith(
      'room-1',
    );
    expect(roundsService.settleCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'STARTED_SPINNING_ROUND',
        roomId: 'room-1',
      }),
    );
  });

  it('starts settling after the spinning phase elapses without paying yet', async () => {
    const spinningRound = buildRound({
      status: RoundStatus.SPINNING,
      spinningAt: new Date('2026-05-26T11:59:00.000Z'),
      winningTicket: 10n,
      winnerEntryId: 'entry-1',
      winnerUserId: 'user-1',
      spinAngle: 42,
      payoutAmount: 100n,
    });
    const { service, roundsService } = buildService({
      currentRound: spinningRound,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.startSettlingCurrentRoundForRoom).toHaveBeenCalledWith(
      'room-1',
    );
    expect(roundsService.settleCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'STARTED_SETTLING_ROUND',
        roomId: 'room-1',
      }),
    );
  });

  it('waits during the settling phase before payout completion', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const settlingRound = buildRound({
      status: RoundStatus.SETTLING,
      settlingAt: new Date('2026-05-26T11:59:59.500Z'),
      winningTicket: 10n,
      winnerEntryId: 'entry-1',
      winnerUserId: 'user-1',
      spinAngle: 42,
      payoutAmount: 100n,
    });
    const { service, roundsService } = buildService({
      currentRound: settlingRound,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.settleCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'WAITING_FOR_SETTLING_PHASE',
        roomId: 'room-1',
        msRemaining: 500,
      }),
    );
  });

  it('settles after the settling phase elapses', async () => {
    const settlingRound = buildRound({
      status: RoundStatus.SETTLING,
      settlingAt: new Date('2026-05-26T11:59:00.000Z'),
      winningTicket: 10n,
      winnerEntryId: 'entry-1',
      winnerUserId: 'user-1',
      spinAngle: 42,
      payoutAmount: 100n,
    });
    const { service, roundsService } = buildService({
      currentRound: settlingRound,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.settleCurrentRoundForRoom).toHaveBeenCalledWith(
      'room-1',
    );
    expect(
      roundsService.startSettlingCurrentRoundForRoom,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: 'SETTLED_ROUND',
        roomId: 'room-1',
      }),
    );
  });

  it('runs the full two-entry lifecycle through completed cooldown into the next OPEN round', async () => {
    let currentRound = buildRound({
      status: RoundStatus.OPEN,
      locksAt: new Date('2026-05-26T11:59:00.000Z'),
      totalEntryAmount: 20n,
      payoutAmount: 20n,
    });
    const activeStatuses = new Set([
      RoundStatus.OPEN,
      RoundStatus.LOCKED,
      RoundStatus.DRAWING,
      RoundStatus.SPINNING,
      RoundStatus.SETTLING,
    ]);
    const { service, prisma, roundsService } = buildService({
      currentRound,
      entryCount: 2,
    });

    prisma.round.findFirst.mockImplementation(
      (query?: { where?: { status?: unknown } }) => {
        if (query?.where?.status) {
          return Promise.resolve(
            activeStatuses.has(currentRound.status) ? currentRound : null,
          );
        }

        return Promise.resolve(currentRound);
      },
    );
    roundsService.lockCurrentRoundForRoom.mockImplementation(async () => {
      currentRound = {
        ...currentRound,
        status: RoundStatus.LOCKED,
        lockedAt: now,
      };

      return { currentRound: roundsService.toRoundSnapshot(currentRound) };
    });
    roundsService.drawCurrentRoundForRoom.mockImplementation(async () => {
      currentRound = {
        ...currentRound,
        status: RoundStatus.DRAWING,
        drawingAt: now,
        winningTicket: 10n,
        winnerEntryId: 'entry-1',
        winnerUserId: 'user-1',
        spinAngle: 42,
      };

      return { currentRound: roundsService.toRoundSnapshot(currentRound) };
    });
    roundsService.startSpinningCurrentRoundForRoom.mockImplementation(
      async () => {
        currentRound = {
          ...currentRound,
          status: RoundStatus.SPINNING,
          spinningAt: now,
        };

        return { currentRound: roundsService.toRoundSnapshot(currentRound) };
      },
    );
    roundsService.startSettlingCurrentRoundForRoom.mockImplementation(
      async () => {
        currentRound = {
          ...currentRound,
          status: RoundStatus.SETTLING,
          settlingAt: now,
        };

        return { currentRound: roundsService.toRoundSnapshot(currentRound) };
      },
    );
    roundsService.settleCurrentRoundForRoom.mockImplementation(async () => {
      currentRound = {
        ...currentRound,
        status: RoundStatus.COMPLETED,
        completedAt: now,
      };

      return { currentRound: roundsService.toRoundSnapshot(currentRound) };
    });
    roundsService.startOpenRoundForRoom.mockImplementation(async () => {
      currentRound = buildRound({
        id: 'round-2',
        roundNumber: 2,
        status: RoundStatus.OPEN,
        locksAt: new Date('2026-05-26T12:00:45.000Z'),
      });

      return roundsService.toRoundSnapshot(currentRound);
    });

    const actions = [
      await service.advanceRoomOnce('room-1'),
      await service.advanceRoomOnce('room-1', { force: true }),
      await service.advanceRoomOnce('room-1', { force: true }),
      await service.advanceRoomOnce('room-1', { force: true }),
      await service.advanceRoomOnce('room-1', { force: true }),
      await service.advanceRoomOnce('room-1', { force: true }),
    ].map((result) => result.action);

    expect(actions).toEqual([
      'LOCKED_ROUND',
      'DREW_ROUND',
      'STARTED_SPINNING_ROUND',
      'STARTED_SETTLING_ROUND',
      'SETTLED_ROUND',
      'STARTED_NEXT_ROUND_AFTER_COMPLETION',
    ]);
    expect(roundsService.settleCurrentRoundForRoom).toHaveBeenCalledTimes(1);
    expect(currentRound.status).toBe(RoundStatus.OPEN);
    expect(currentRound.roundNumber).toBe(2);
  });

  it('starts the next open round after completed-round cooldown', async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const { service, roundsService } = buildService({
      currentRound: null,
      latestRound: completedRound,
    });

    const result = await service.advanceRoomOnce('room-1');

    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith('room-1');
    expect(result).toEqual(
      expect.objectContaining({
        action: 'STARTED_NEXT_ROUND_AFTER_COMPLETION',
        roomId: 'room-1',
      }),
    );
  });

  it('broadcasts machine results after the lock-protected advance finishes', async () => {
    jest.useFakeTimers();
    const events: string[] = [];
    const { service, roomGateway } = buildService({ lockEvents: events });

    roomGateway.broadcastMachineResult.mockImplementation(async () => {
      events.push('broadcast');
    });

    (service as any).states.set('room-1', {
      roomId: 'room-1',
      isRunning: true,
      tickCount: 0,
      lastAction: null,
      lastError: null,
      lastTickAt: null,
      nextTickAt: null,
    });

    await (service as any).tickRoom('room-1');

    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['lock:start', 'lock:end', 'broadcast']);

    service.onModuleDestroy();
  });

  it('schedules the next tick even when machine broadcasts are slow', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service, roomGateway } = buildService({
      currentRound: null,
      latestRound: null,
    });

    roomGateway.broadcastMachineResult.mockReturnValue(new Promise(() => {}));

    (service as any).states.set('room-1', {
      roomId: 'room-1',
      isRunning: true,
      tickCount: 0,
      lastAction: null,
      lastError: null,
      lastTickAt: null,
      nextTickAt: null,
    });

    const result = await (service as any).tickRoom('room-1');

    expect(result).toBeUndefined();
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        action: 'STARTED_OPEN_ROUND',
      }),
    );
    expect(jest.getTimerCount()).toBe(1);

    service.onModuleDestroy();
  });

  it('schedules completed cooldown follow-up ticks with catch-up priority', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const settlingRound = buildRound({
      status: RoundStatus.SETTLING,
      settlingAt: new Date('2026-05-26T11:59:00.000Z'),
      winnerEntryId: 'entry-1',
      winnerUserId: 'user-1',
    });
    const { service } = buildService({
      currentRound: settlingRound,
      entryCount: 2,
    });
    const scheduled: {
      roomId: string;
      delayMs: number;
      priority: number | undefined;
    }[] = [];
    const originalScheduleNextTick = (service as any).scheduleNextTick.bind(
      service,
    );
    jest
      .spyOn(service as any, 'scheduleNextTick')
      .mockImplementation(
        (roomId: string, delayMs: number, priority?: number) => {
          scheduled.push({ roomId, delayMs, priority });
          return originalScheduleNextTick(roomId, delayMs, priority);
        },
      );

    (service as any).states.set('room-1', {
      roomId: 'room-1',
      isRunning: true,
      tickCount: 0,
      lastAction: null,
      lastError: null,
      lastTickAt: null,
      nextTickAt: null,
    });

    await (service as any).tickRoom('room-1');

    const cooldownPriority = (service as any).getNextTickPriority({
      action: 'SETTLED_ROUND',
    });
    const regularPriority = (service as any).getNextTickPriority({
      action: 'STARTED_SPINNING_ROUND',
    });

    expect(cooldownPriority).toBeLessThan(regularPriority);
    expect(scheduled).toContainEqual({
      roomId: 'room-1',
      delayMs: 9_000,
      priority: cooldownPriority,
    });

    service.onModuleDestroy();
  });
});
