import { createHash } from 'node:crypto';
import { RoundStatus } from '@kingspin/db';
import { RoundsService } from './rounds.service';

const now = new Date('2026-05-26T12:00:00.000Z');
const serverSeed =
  '375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d';
const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex');

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
    serverSeedHash,
    serverSeedReveal: serverSeed,
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
          payoutAmount: 3_500n,
        }),
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
        houseFeeAmount: 0n,
        payoutAmount: 3_500n,
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
    });
    const entries = [
      buildEntry('a', 1_500n, { ticketStart: 0n, ticketEnd: 1_499n }),
      buildEntry('b', 2_000n, { ticketStart: 1_500n, ticketEnd: 3_499n }),
    ];
    const drawnRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      spinAngle: 202.4228,
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
          winningTicket: 1_968n,
          winnerEntryId: 'b',
          winnerUserId: 'user-b',
          spinAngle: 202.4228,
        }),
      }),
    );
    expect(result.winningTicket).toBe('1968');
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
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 }),
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

  it('settles a spinning round by crediting the winner once', async () => {
    const spinningRound = buildRound({
      status: RoundStatus.SPINNING,
      drawingAt: now,
      spinningAt: now,
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
    });
    const settlingRound = buildRound({
      ...spinningRound,
      status: RoundStatus.SETTLING,
      settlingAt: now,
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
        findFirst: jest.fn().mockResolvedValue(spinningRound),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(settlingRound)
          .mockResolvedValueOnce(completedRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
        findUniqueOrThrow: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const walletsService = {
      creditRoundWin: jest.fn().mockResolvedValue({
        reused: false,
        wallet: { id: 'wallet-1', balanceSnapshot: '3500' },
      }),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.settleCurrentRoundForRoom('room-1');

    expect(walletsService.creditRoundWin).toHaveBeenCalledTimes(1);
    expect(walletsService.creditRoundWin).toHaveBeenCalledWith({
      userId: 'user-b',
      roundId: spinningRound.id,
      winnerEntryId: 'b',
      amount: 3_500n,
    });
    expect(result).toEqual(
      expect.objectContaining({
        payoutAmount: '3500',
        reused: false,
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
      winningTicket: 1_968n,
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      spinAngle: 202.4228,
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
        recomputedWinningTicket: '1968',
      }),
    );
    expect(result.winnerEntry).toEqual(
      expect.objectContaining({
        id: 'b',
        userId: 'user-b',
      }),
    );
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
