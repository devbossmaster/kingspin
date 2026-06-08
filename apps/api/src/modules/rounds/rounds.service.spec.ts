import { createHash } from 'node:crypto';
import { RoundStatus } from '@kingspin/db';
import { FAIRNESS_ALGORITHM } from '@kingspin/game-engine';
import {
  calculatePlatformFeeAmount,
  RoundsService,
} from './rounds.service';

const now = new Date('2026-05-26T12:00:00.000Z');
const serverSeed =
  '375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d';
const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex');
const entriesHash =
  '425d3f746b8c9858ea14a98433ecffbe7eaae92305781c636a80be6e96097850';
const drawHash =
  '7f7cd80fcc95aef291cb43f849ace4dfb4a1cd15ff2e84f41d6fd041ec6cbc20';

function buildRound(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmpmhquq2000gcfq01znqehcp',
    roomId: 'room-1',
    roundNumber: 2,
    status: RoundStatus.OPEN,
    openedAt: now,
    locksAt: new Date('2026-05-26T12:00:45.000Z'),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    totalEntryAmount: 3_500n,
    houseFeeAmount: 0n,
    payoutAmount: 3_500n,
    platformFeeBps: 2_000,
    serverSeedHash,
    serverSeedReveal: serverSeed,
    fairnessAlgorithm: FAIRNESS_ALGORITHM,
    entriesHash: null,
    drawHash: null,
    drawNonce: null,
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
    idempotencyKey: 'round:start:room-1:2',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildEntry(
  id: string,
  amount: bigint,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    roundId: 'cmpmhquq2000gcfq01znqehcp',
    userId: `user-${id}`,
    amount,
    ticketStart: null,
    ticketEnd: null,
    isWinner: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildLatestResultRows(round: any, entries: any[]) {
  if (entries.length === 0) {
    return [
      {
        roundId: round.id,
        roundRoomId: round.roomId,
        roundNumber: round.roundNumber,
        roundStatus: round.status,
        roundOpenedAt: round.openedAt,
        roundLocksAt: round.locksAt,
        roundLockedAt: round.lockedAt,
        roundDrawingAt: round.drawingAt,
        roundSpinningAt: round.spinningAt,
        roundSettlingAt: round.settlingAt,
        roundCompletedAt: round.completedAt,
        roundCancelledAt: round.cancelledAt,
        roundTotalEntryAmount: round.totalEntryAmount,
        roundHouseFeeAmount: round.houseFeeAmount,
        roundPayoutAmount: round.payoutAmount,
        roundServerSeedHash: round.serverSeedHash,
        roundServerSeedReveal: round.serverSeedReveal,
        roundFairnessAlgorithm: round.fairnessAlgorithm,
        roundEntriesHash: round.entriesHash,
        roundDrawHash: round.drawHash,
        roundDrawNonce: round.drawNonce,
        roundWinningTicket: round.winningTicket,
        roundWinnerUserId: round.winnerUserId,
        roundWinnerEntryId: round.winnerEntryId,
        roundSpinAngle: round.spinAngle,
        entryId: null,
        entryRoundId: null,
        entryUserId: null,
        entryAmount: null,
        entryTicketStart: null,
        entryTicketEnd: null,
        entryIsWinner: null,
        entryCreatedAt: null,
        entryUpdatedAt: null,
        entryPlayerId: null,
        entryPlayerUsername: null,
        entryPlayerFullName: null,
      },
    ];
  }

  return entries.map((entry) => ({
    roundId: round.id,
    roundRoomId: round.roomId,
    roundNumber: round.roundNumber,
    roundStatus: round.status,
    roundOpenedAt: round.openedAt,
    roundLocksAt: round.locksAt,
    roundLockedAt: round.lockedAt,
    roundDrawingAt: round.drawingAt,
    roundSpinningAt: round.spinningAt,
    roundSettlingAt: round.settlingAt,
    roundCompletedAt: round.completedAt,
    roundCancelledAt: round.cancelledAt,
    roundTotalEntryAmount: round.totalEntryAmount,
    roundHouseFeeAmount: round.houseFeeAmount,
    roundPayoutAmount: round.payoutAmount,
    roundServerSeedHash: round.serverSeedHash,
    roundServerSeedReveal: round.serverSeedReveal,
    roundFairnessAlgorithm: round.fairnessAlgorithm,
    roundEntriesHash: round.entriesHash,
    roundDrawHash: round.drawHash,
    roundDrawNonce: round.drawNonce,
    roundWinningTicket: round.winningTicket,
    roundWinnerUserId: round.winnerUserId,
    roundWinnerEntryId: round.winnerEntryId,
    roundSpinAngle: round.spinAngle,
    entryId: entry.id,
    entryRoundId: entry.roundId,
    entryUserId: entry.userId,
    entryAmount: entry.amount,
    entryTicketStart: entry.ticketStart,
    entryTicketEnd: entry.ticketEnd,
    entryIsWinner: entry.isWinner,
    entryCreatedAt: entry.createdAt,
    entryUpdatedAt: entry.updatedAt,
    entryPlayerId: entry.user?.id ?? null,
    entryPlayerUsername: entry.user?.username ?? null,
    entryPlayerFullName: entry.user?.fullName ?? null,
  }));
}

describe('RoundsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('calculates the configured platform fee in basis points', () => {
    expect(calculatePlatformFeeAmount(1_000n, 2_000)).toBe(200n);
    expect(calculatePlatformFeeAmount(999n, 2_000)).toBe(199n);
    expect(calculatePlatformFeeAmount(1_000n, 0)).toBe(0n);
  });

  it('never exposes the active round server seed reveal', () => {
    const service = new RoundsService({} as any, {} as any);
    const snapshot = service.toRoundSnapshot(buildRound());

    expect(snapshot).toMatchObject({
      serverSeedHash,
      fairnessAlgorithm: FAIRNESS_ALGORITHM,
      grossPoolAmount: '3500',
      platformFeeAmount: '700',
      netPrizeAmount: '2800',
      platformFeeBps: 2_000,
    });
    expect(snapshot).not.toHaveProperty('serverSeedReveal');
  });

  it('assigns proportional ticket ranges when locking the current round', async () => {
    const openRound = buildRound({
      totalEntryAmount: 0n,
      payoutAmount: 0n,
    });
    const finalEntries = [
      buildEntry('a', 1_500n, { ticketStart: 0n, ticketEnd: 1_499n }),
      buildEntry('b', 2_000n, { ticketStart: 1_500n, ticketEnd: 3_499n }),
    ];
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([
        {
          entryCount: 2n,
          totalAmount: 3_500n,
        },
      ]),
      round: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          ...openRound,
          status: RoundStatus.LOCKED,
          lockedAt: now,
          totalEntryAmount: 3_500n,
          houseFeeAmount: 700n,
          payoutAmount: 2_800n,
          platformFeeBps: 2_000,
          entriesHash,
        }),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(finalEntries),
      },
    };
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(openRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(finalEntries),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.lockCurrentRoundForRoom('room-1');

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.round.update).toHaveBeenCalledWith({
      where: { id: openRound.id },
      data: expect.objectContaining({
        totalEntryAmount: 3_500n,
        houseFeeAmount: 700n,
        payoutAmount: 2_800n,
        platformFeeBps: 2_000,
        fairnessAlgorithm: FAIRNESS_ALGORITHM,
        entriesHash,
      }),
    });
    expect(prisma.entry.findMany).toHaveBeenCalledWith({
      where: { roundId: openRound.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(result.entries).toEqual([
      expect.objectContaining({ id: 'a', ticketStart: '0', ticketEnd: '1499' }),
      expect.objectContaining({
        id: 'b',
        ticketStart: '1500',
        ticketEnd: '3499',
      }),
    ]);
    expect(result.currentRound.totalEntryAmount).toBe('3500');
  });

  it('draws a deterministic winner from assigned ticket ranges', async () => {
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: now,
      entriesHash,
    });
    const entries = [
      buildEntry('a', 1_500n, { ticketStart: 0n, ticketEnd: 1_499n }),
      buildEntry('b', 2_000n, { ticketStart: 1_500n, ticketEnd: 3_499n }),
    ];
    const drawnRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: now,
      entriesHash,
      drawHash,
      drawNonce: 0,
      winningTicket: 2_696n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      spinAngle: 277.3028,
    });
    const finalEntries = [
      entries[0],
      buildEntry('b', 2_000n, {
        ticketStart: 1_500n,
        ticketEnd: 3_499n,
        isWinner: true,
      }),
    ];
    const tx = {
      round: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(drawnRound),
      },
      entry: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue(finalEntries),
      },
    };
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(lockedRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.drawCurrentRoundForRoom('room-1');

    expect(tx.round.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          winningTicket: 2_696n,
          fairnessAlgorithm: FAIRNESS_ALGORITHM,
          entriesHash,
          drawHash,
          drawNonce: 0,
          winnerEntryId: 'b',
          winnerUserId: 'user-b',
          spinAngle: 277.3028,
        }),
      }),
    );
    expect(result.winningTicket).toBe('2696');
    expect(result.winnerEntry).toEqual(
      expect.objectContaining({
        id: 'b',
        isWinner: true,
      }),
    );
  });

  it('starts the spinning phase after a server-side draw', async () => {
    const drawnRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      spinAngle: 202.4228,
    });
    const spinningRound = buildRound({
      ...drawnRound,
      status: RoundStatus.SPINNING,
      spinningAt: now,
    });
    const winnerEntry = buildEntry('b', 2_000n, {
      userId: 'user-b',
      ticketStart: 1_500n,
      ticketEnd: 3_499n,
      isWinner: true,
    });
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(drawnRound),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(spinningRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.startSpinningCurrentRoundForRoom('room-1');

    expect(prisma.round.updateMany).toHaveBeenCalledWith({
      where: {
        id: drawnRound.id,
        status: RoundStatus.DRAWING,
        winningTicket: { not: null },
        winnerEntryId: { not: null },
        winnerUserId: { not: null },
        spinAngle: { not: null },
      },
      data: {
        status: RoundStatus.SPINNING,
        spinningAt: expect.any(Date),
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        currentRound: expect.objectContaining({
          status: RoundStatus.SPINNING,
          spinAngle: 202.4228,
        }),
        winnerEntry: expect.objectContaining({ id: 'b' }),
        reused: false,
      }),
    );
  });

  it('cancels a current round and reports idempotent hold refunds', async () => {
    const openRound = buildRound();
    const cancelledRound = buildRound({
      status: RoundStatus.CANCELLED,
      cancelledAt: now,
    });
    const entries = [buildEntry('a', 1_500n), buildEntry('b', 2_000n)];
    const tx = {
      $executeRaw: jest.fn(),
      round: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(openRound),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(cancelledRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const walletsService = {
      refundEntryHoldsByEntryId: jest
        .fn()
        .mockResolvedValueOnce({
          entryId: 'a',
          refunded: true,
          amount: 1_500n,
          reason: 'REFUNDED',
        })
        .mockResolvedValueOnce({
          entryId: 'b',
          refunded: false,
          amount: 2_000n,
          reason: 'ALREADY_REFUNDED',
        }),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.cancelCurrentRoundForRoom('room-1');

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(walletsService.refundEntryHoldsByEntryId).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        refundedCount: 1,
        alreadyRefundedCount: 1,
        refundedAmount: '3500',
      }),
    );
  });

  it('cancels an expired empty OPEN round and creates the next OPEN in one transaction', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const expiredRound = buildRound({
      totalEntryAmount: 0n,
      payoutAmount: 0n,
      locksAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const cancelledRound = buildRound({
      ...expiredRound,
      status: RoundStatus.CANCELLED,
      cancelledAt: now,
    });
    const nextRound = buildRound({
      id: 'round-3',
      roundNumber: 3,
      totalEntryAmount: 0n,
      payoutAmount: 0n,
      openedAt: now,
      locksAt: new Date('2026-05-26T12:00:43.000Z'),
      idempotencyKey: 'round:start:room-1:3',
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      $executeRaw: jest.fn(),
      room: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'room-1',
          status: 'ACTIVE',
          roundDurationMs: 45_000,
        }),
      },
      round: {
        findUnique: jest.fn().mockResolvedValueOnce(expiredRound),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(expiredRound)
          .mockResolvedValueOnce(cancelledRound),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn((query?: { where?: { status?: unknown } }) => {
          if (query?.where?.status) {
            return Promise.resolve(null);
          }

          return Promise.resolve({ roundNumber: expiredRound.roundNumber });
        }),
        create: jest.fn().mockResolvedValue(nextRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const walletsService = {
      refundEntryHolds: jest.fn(),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.cancelExpiredOpenRoundAndStartNextForRoom(
      'room-1',
      expiredRound.id,
    );

    expect(tx.round.updateMany).toHaveBeenCalledWith({
      where: {
        id: expiredRound.id,
        status: { in: [RoundStatus.OPEN, RoundStatus.LOCKED] },
      },
      data: {
        status: RoundStatus.CANCELLED,
        cancelledAt: expect.any(Date),
      },
    });
    expect(tx.round.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 'room-1',
          roundNumber: 3,
          status: RoundStatus.OPEN,
          locksAt: new Date('2026-05-26T12:00:43.000Z'),
          platformFeeBps: 2_000,
        }),
      }),
    );
    expect(walletsService.refundEntryHolds).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        cancelledRound: expect.objectContaining({
          status: RoundStatus.CANCELLED,
        }),
        currentRound: expect.objectContaining({
          id: 'round-3',
          status: RoundStatus.OPEN,
          locksAt: '2026-05-26T12:00:43.000Z',
        }),
      }),
    );
  });

  it('fast-cancels an expired empty OPEN round and creates the next OPEN with one DB statement', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const expiredRound = buildRound({
      totalEntryAmount: 0n,
      payoutAmount: 0n,
      locksAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const cancelledRound = buildRound({
      ...expiredRound,
      status: RoundStatus.CANCELLED,
      cancelledAt: now,
    });
    const nextRound = buildRound({
      id: 'round-3',
      roundNumber: 3,
      totalEntryAmount: 0n,
      payoutAmount: 0n,
      openedAt: now,
      locksAt: new Date('2026-05-26T12:00:45.000Z'),
    });
    const row = {
      cancelledId: cancelledRound.id,
      cancelledRoomId: cancelledRound.roomId,
      cancelledRoundNumber: cancelledRound.roundNumber,
      cancelledStatus: cancelledRound.status,
      cancelledTotalEntryAmount: cancelledRound.totalEntryAmount,
      cancelledHouseFeeAmount: cancelledRound.houseFeeAmount,
      cancelledPayoutAmount: cancelledRound.payoutAmount,
      cancelledOpenedAt: cancelledRound.openedAt,
      cancelledLocksAt: cancelledRound.locksAt,
      cancelledLockedAt: cancelledRound.lockedAt,
      cancelledDrawingAt: cancelledRound.drawingAt,
      cancelledSpinningAt: cancelledRound.spinningAt,
      cancelledSettlingAt: cancelledRound.settlingAt,
      cancelledCompletedAt: cancelledRound.completedAt,
      cancelledCancelledAt: cancelledRound.cancelledAt,
      cancelledServerSeedHash: cancelledRound.serverSeedHash,
      cancelledWinningTicket: cancelledRound.winningTicket,
      cancelledWinnerUserId: cancelledRound.winnerUserId,
      cancelledWinnerEntryId: cancelledRound.winnerEntryId,
      cancelledSpinAngle: cancelledRound.spinAngle,
      nextId: nextRound.id,
      nextRoomId: nextRound.roomId,
      nextRoundNumber: nextRound.roundNumber,
      nextStatus: nextRound.status,
      nextTotalEntryAmount: nextRound.totalEntryAmount,
      nextHouseFeeAmount: nextRound.houseFeeAmount,
      nextPayoutAmount: nextRound.payoutAmount,
      nextOpenedAt: nextRound.openedAt,
      nextLocksAt: nextRound.locksAt,
      nextLockedAt: nextRound.lockedAt,
      nextDrawingAt: nextRound.drawingAt,
      nextSpinningAt: nextRound.spinningAt,
      nextSettlingAt: nextRound.settlingAt,
      nextCompletedAt: nextRound.completedAt,
      nextCancelledAt: nextRound.cancelledAt,
      nextServerSeedHash: nextRound.serverSeedHash,
      nextWinningTicket: nextRound.winningTicket,
      nextWinnerUserId: nextRound.winnerUserId,
      nextWinnerEntryId: nextRound.winnerEntryId,
      nextSpinAngle: nextRound.spinAngle,
    };
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([row]),
    };
    const walletsService = {
      refundEntryHolds: jest.fn(),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.cancelExpiredEmptyOpenRoundAndStartNextForRoom(
      'room-1',
      expiredRound.id,
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(walletsService.refundEntryHolds).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        cancelledRound: expect.objectContaining({
          status: RoundStatus.CANCELLED,
        }),
        currentRound: expect.objectContaining({
          id: 'round-3',
          status: RoundStatus.OPEN,
          locksAt: '2026-05-26T12:00:45.000Z',
        }),
        refundSummary: expect.objectContaining({
          refundedCount: 0,
          refundedAmount: '0',
        }),
      }),
    );
  });

  it('falls back from the fast empty transition when the DB does not confirm zero entries', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const service = new RoundsService(prisma as any, {} as any);

    await expect(
      service.cancelExpiredEmptyOpenRoundAndStartNextForRoom(
        'room-1',
        'round-1',
      ),
    ).resolves.toBeNull();
  });

  it('cancels an expired OPEN round directly without persisting LOCKED', async () => {
    const expiredRound = buildRound({
      locksAt: new Date('2026-05-26T11:59:00.000Z'),
      totalEntryAmount: 0n,
      payoutAmount: 0n,
    });
    const cancelledRound = buildRound({
      ...expiredRound,
      status: RoundStatus.CANCELLED,
      cancelledAt: now,
    });
    const tx = {
      $executeRaw: jest.fn(),
      round: {
        findUnique: jest.fn().mockResolvedValue(expiredRound),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(cancelledRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const walletsService = {
      refundEntryHolds: jest.fn(),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.cancelExpiredOpenRoundForRoom(
      'room-1',
      expiredRound.id,
    );

    expect(tx.round.updateMany).toHaveBeenCalledWith({
      where: {
        id: expiredRound.id,
        status: RoundStatus.OPEN,
      },
      data: {
        status: RoundStatus.CANCELLED,
        cancelledAt: expect.any(Date),
      },
    });
    expect(tx.round.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'lockedAt',
    );
    expect(walletsService.refundEntryHolds).not.toHaveBeenCalled();
    expect(result.currentRound.status).toBe(RoundStatus.CANCELLED);
    expect(result.refundedCount).toBe(0);
  });

  it('refunds a single-entry expired OPEN round before opening the next round can proceed', async () => {
    const expiredRound = buildRound({
      locksAt: new Date('2026-05-26T11:59:00.000Z'),
    });
    const cancelledRound = buildRound({
      ...expiredRound,
      status: RoundStatus.CANCELLED,
      cancelledAt: now,
    });
    const entry = buildEntry('a', 1_500n);
    const tx = {
      $executeRaw: jest.fn(),
      round: {
        findUnique: jest.fn().mockResolvedValue(expiredRound),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(cancelledRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue([entry]),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const walletsService = {
      refundEntryHolds: jest.fn().mockResolvedValue({
        entryId: entry.id,
        refunded: true,
        amount: entry.amount,
        reason: 'REFUNDED',
      }),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.cancelExpiredOpenRoundForRoom(
      'room-1',
      expiredRound.id,
    );

    expect(walletsService.refundEntryHolds).toHaveBeenCalledWith(tx, {
      roundId: expiredRound.id,
      entryId: entry.id,
    });
    expect(result.currentRound.status).toBe(RoundStatus.CANCELLED);
    expect(result.refundedCount).toBe(1);
    expect(result.refundedAmount).toBe('1500');
  });

  it('starts SETTLING from SPINNING without crediting payout yet', async () => {
    const spinningRound = buildRound({
      status: RoundStatus.SPINNING,
      drawingAt: now,
      spinningAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      spinAngle: 202.4228,
    });
    const settlingRound = buildRound({
      ...spinningRound,
      status: RoundStatus.SETTLING,
      settlingAt: now,
    });
    const winnerEntry = buildEntry('b', 2_000n, {
      userId: 'user-b',
      ticketStart: 1_500n,
      ticketEnd: 3_499n,
      isWinner: true,
    });
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(spinningRound),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValueOnce(settlingRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const walletsService = {
      creditRoundWin: jest.fn(),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.startSettlingCurrentRoundForRoom('room-1');

    expect(prisma.round.updateMany).toHaveBeenCalledWith({
      where: {
        id: spinningRound.id,
        status: RoundStatus.SPINNING,
        winnerEntryId: { not: null },
        winnerUserId: { not: null },
        winningTicket: { not: null },
        spinAngle: { not: null },
      },
      data: {
        status: RoundStatus.SETTLING,
        settlingAt: expect.any(Date),
      },
    });
    expect(walletsService.creditRoundWin).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        payoutAmount: '3500',
        payout: null,
        currentRound: expect.objectContaining({
          status: RoundStatus.SETTLING,
        }),
      }),
    );
  });

  it('resumes a settling round without restarting the settling transition', async () => {
    const settlingRound = buildRound({
      status: RoundStatus.SETTLING,
      drawingAt: now,
      spinningAt: now,
      settlingAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      houseFeeAmount: 700n,
      payoutAmount: 2_800n,
    });
    const completedRound = buildRound({
      ...settlingRound,
      status: RoundStatus.COMPLETED,
      completedAt: now,
    });
    const winnerEntry = buildEntry('b', 2_000n, {
      userId: 'user-b',
      ticketStart: 1_500n,
      ticketEnd: 3_499n,
      isWinner: true,
    });
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(settlingRound),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(completedRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
        findUniqueOrThrow: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const walletsService = {
      creditRoundWin: jest.fn().mockResolvedValue({
        reused: true,
        wallet: { id: 'wallet-1', balanceSnapshot: '3500' },
      }),
      creditPlatformFee: jest.fn().mockResolvedValue(null),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.settleCurrentRoundForRoom('room-1');

    expect(prisma.round.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.round.updateMany).toHaveBeenCalledWith({
      where: {
        id: settlingRound.id,
        status: RoundStatus.SETTLING,
      },
      data: {
        status: RoundStatus.COMPLETED,
        completedAt: expect.any(Date),
      },
    });
    expect(walletsService.creditRoundWin).toHaveBeenCalledTimes(1);
    expect(walletsService.creditRoundWin).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2_800n }),
    );
    expect(walletsService.creditPlatformFee).toHaveBeenCalledTimes(1);
    expect(walletsService.creditPlatformFee).toHaveBeenCalledWith({
      roundId: settlingRound.id,
      amount: 700n,
      platformFeeBps: 2_000,
    });
    expect(result).toEqual(
      expect.objectContaining({
        currentRound: expect.objectContaining({
          status: RoundStatus.COMPLETED,
        }),
        reused: true,
      }),
    );
  });

  it('replays settlement for a completed round without another payout', async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
    });
    const winnerEntry = buildEntry('b', 2_000n, {
      userId: 'user-b',
      ticketStart: 1_500n,
      ticketEnd: 3_499n,
      isWinner: true,
    });
    const prisma = {
      round: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(completedRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const walletsService = {
      creditRoundWin: jest.fn(),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.settleCurrentRoundForRoom('room-1');

    expect(walletsService.creditRoundWin).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        payoutAmount: '3500',
        payout: null,
        reused: true,
      }),
    );
  });

  it('returns a latest-result fairness proof that verifies', async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: now,
      entriesHash,
      drawHash,
      drawNonce: 0,
      winningTicket: 2_696n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      spinAngle: 277.3028,
    });
    const entries = [
      buildEntry('a', 1_500n, {
        ticketStart: 0n,
        ticketEnd: 1_499n,
        user: {
          id: 'user-a',
          username: 'player-a',
          fullName: 'Player A',
        },
      }),
      buildEntry('b', 2_000n, {
        userId: 'user-b',
        ticketStart: 1_500n,
        ticketEnd: 3_499n,
        isWinner: true,
        user: {
          id: 'user-b',
          username: 'player-b',
          fullName: 'Player B',
        },
      }),
    ];
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(buildLatestResultRows(completedRound, entries)),
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.getLatestRoundResultForRoom('room-1');

    expect(result.fairness).toEqual(
      expect.objectContaining({
        seedHashMatches: true,
        winningTicketMatches: true,
        winnerTicketInsideRange: true,
        rangesCoverTotal: true,
        rangeError: null,
        entriesHashMatches: true,
        drawHashMatches: true,
        verificationPassed: true,
        recomputedWinningTicket: '2696',
      }),
    );
    expect(result.serverSeedReveal).toBe(serverSeed);
    expect(result.winnerEntry).toEqual(
      expect.objectContaining({
        id: 'b',
        userId: 'user-b',
      }),
    );
  });

  it('caps each public winner feed at 15 while preserving room capacity', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          roundId: 'round-1',
          roomId: 'room-1',
          roomCode: 'PRO-A',
          roomName: 'A01',
          roomMaxPlayers: 30,
          roomGameMode: 'FLEXIBLE_PROPORTIONAL',
          categorySlug: 'pro-10-100',
          categoryName: 'Jemaw 1',
          roundNumber: 4,
          completedAt: now,
          totalEntryAmount: 300n,
          payoutAmount: 270n,
          winnerUserId: 'user-a',
          winnerEntryId: 'entry-a',
          winnerEntryAmount: 10n,
          winnerUsername: 'player-a',
          playerCount: 30n,
          entryCount: 30n,
        },
      ]),
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.getPublicWinnerFeed('latest', 30);

    expect(result.limit).toBe(15);
    expect(result.winners).toEqual([
      expect.objectContaining({
        rank: 1,
        winnerUsername: 'player-a',
        playerCount: 30,
        roomMaxPlayers: 30,
      }),
    ]);
  });

  it('deduplicates in-flight latest-result generation per room', async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
    });
    const entries = [
      buildEntry('a', 1_500n, { ticketStart: 0n, ticketEnd: 1_499n }),
      buildEntry('b', 2_000n, {
        userId: 'user-b',
        ticketStart: 1_500n,
        ticketEnd: 3_499n,
        isWinner: true,
      }),
    ];
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(buildLatestResultRows(completedRound, entries)),
    };
    const service = new RoundsService(prisma as any, {} as any);

    await Promise.all([
      service.getLatestRoundResultForRoom('room-1'),
      service.getLatestRoundResultForRoom('room-1'),
    ]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
