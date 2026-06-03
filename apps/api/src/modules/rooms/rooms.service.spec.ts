import { BadRequestException } from '@nestjs/common';
import { RoomStatus, RoundStatus } from '@kingspin/db';
import { RoomsService } from './rooms.service';

const now = new Date('2026-05-30T12:00:00.000Z');

function buildService(rows: unknown[] = []) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    room: {
      findUnique: jest.fn().mockResolvedValue({
        category: {
          slug: 'db-category',
        },
      }),
    },
  };
  const roundsService = {
    findCurrentRoundForRoom: jest.fn(),
  };

  return {
    service: new RoomsService(prisma as any, roundsService as any),
    prisma,
    roundsService,
  };
}

describe('RoomsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('requires a category slug for public room summaries', async () => {
    const { service, prisma } = buildService();

    await expect(service.findActiveByCategorySlug('')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reuses category slug learned while building live summaries', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service, prisma } = buildService([
      {
        roomId: 'room-open',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-A',
        roomName: 'Pro A',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-open',
        roundNumber: 7,
        roundStatus: RoundStatus.OPEN,
        roundLocksAt: new Date('2026-05-30T12:00:30.000Z'),
        roundLockedAt: null,
        roundDrawingAt: null,
        roundSpinningAt: null,
        roundSettlingAt: null,
        roundWinnerEntryId: null,
        roundCompletedAt: null,
        roundCancelledAt: null,
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 0,
        playerCount: 0,
        liveEntryAmount: 0n,
      },
    ]);

    await service.findActiveByCategorySlug('pro-10-100');
    const categorySlug = await service.findCategorySlugForRoom('room-open');

    expect(categorySlug).toBe('pro-10-100');
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it('returns live room summary fields for cards without private fairness data', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service, prisma } = buildService([
      {
        roomId: 'room-open',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-A',
        roomName: 'Pro A',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: new Date('2026-05-30T11:00:00.000Z'),
        roundId: 'round-open',
        roundNumber: 7,
        roundStatus: RoundStatus.OPEN,
        roundLocksAt: new Date('2026-05-30T12:00:30.000Z'),
        roundLockedAt: null,
        roundDrawingAt: null,
        roundSpinningAt: null,
        roundSettlingAt: null,
        roundWinnerEntryId: null,
        roundCompletedAt: null,
        roundCancelledAt: null,
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 2,
        playerCount: 2,
        liveEntryAmount: 150n,
      },
      {
        roomId: 'room-completed',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-B',
        roomName: null,
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FIXED_EQUAL_CHANCE',
        roomFixedEntryAmount: 50n,
        roomIsPermanent: true,
        roomMaxPlayers: 12,
        roomRoundDurationMs: 30_000,
        roomActivatedAt: null,
        roundId: 'round-completed',
        roundNumber: 12,
        roundStatus: RoundStatus.COMPLETED,
        roundLocksAt: new Date('2026-05-30T11:59:00.000Z'),
        roundLockedAt: new Date('2026-05-30T11:59:00.000Z'),
        roundDrawingAt: new Date('2026-05-30T11:59:02.000Z'),
        roundSpinningAt: new Date('2026-05-30T11:59:03.000Z'),
        roundSettlingAt: new Date('2026-05-30T11:59:08.000Z'),
        roundWinnerEntryId: 'entry-winner',
        roundCompletedAt: new Date('2026-05-30T11:59:09.000Z'),
        roundCancelledAt: null,
        roundTotalEntryAmount: 300n,
        roundPayoutAmount: 285n,
        entryCount: 3,
        playerCount: 3,
        liveEntryAmount: 999n,
      },
    ]);

    const result = await service.findActiveByCategorySlug('pro-10-100');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'room-open',
        code: 'PRO-A',
        name: 'Pro A',
        status: RoomStatus.ACTIVE,
        gameMode: 'FLEXIBLE_PROPORTIONAL',
        fixedEntryAmount: null,
        maxPlayers: 15,
        serverNow: now.toISOString(),
        currentRound: expect.objectContaining({
          id: 'round-open',
          roundNumber: 7,
          status: RoundStatus.OPEN,
          phase: 'ENTRY_OPEN',
          phaseLabel: 'ENTRY OPEN',
          locksAt: '2026-05-30T12:00:30.000Z',
          msUntilLock: 30_000,
          msUntilPhaseEnd: 30_000,
          msUntilNextRound: null,
          resultReason: null,
          playerCount: 2,
          entryCount: 2,
          totalEntryAmount: '150',
          payoutAmount: '150',
          totalPool: '150',
        }),
      }),
      expect.objectContaining({
        id: 'room-completed',
        code: 'PRO-B',
        name: null,
        gameMode: 'FIXED_EQUAL_CHANCE',
        fixedEntryAmount: '50',
        currentRound: expect.objectContaining({
          id: 'round-completed',
          roundNumber: 12,
          status: RoundStatus.COMPLETED,
          phase: 'RESULT',
          resultReason: 'WINNER',
          msUntilLock: 0,
          totalEntryAmount: '300',
          payoutAmount: '285',
          totalPool: '285',
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('serverSeed');
  });

  it('keeps active permanent room summaries non-null for terminal fallback rounds', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service } = buildService([
      {
        roomId: 'room-cancelled',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-C',
        roomName: 'Pro C',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-cancelled',
        roundNumber: 21,
        roundStatus: RoundStatus.CANCELLED,
        roundLocksAt: new Date('2026-05-30T11:59:00.000Z'),
        roundLockedAt: null,
        roundDrawingAt: null,
        roundSpinningAt: null,
        roundSettlingAt: null,
        roundWinnerEntryId: null,
        roundCompletedAt: null,
        roundCancelledAt: new Date('2026-05-30T11:59:00.000Z'),
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 0,
        playerCount: 0,
        liveEntryAmount: 0n,
      },
      {
        roomId: 'room-completed',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-D',
        roomName: 'Pro D',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-completed',
        roundNumber: 22,
        roundStatus: RoundStatus.COMPLETED,
        roundLocksAt: new Date('2026-05-30T11:59:00.000Z'),
        roundLockedAt: new Date('2026-05-30T11:59:00.000Z'),
        roundDrawingAt: new Date('2026-05-30T11:59:02.000Z'),
        roundSpinningAt: new Date('2026-05-30T11:59:03.000Z'),
        roundSettlingAt: new Date('2026-05-30T11:59:08.000Z'),
        roundWinnerEntryId: 'entry-winner',
        roundCompletedAt: new Date('2026-05-30T11:59:00.000Z'),
        roundCancelledAt: null,
        roundTotalEntryAmount: 300n,
        roundPayoutAmount: 300n,
        entryCount: 2,
        playerCount: 2,
        liveEntryAmount: 999n,
      },
    ]);

    const result = await service.findActiveByCategorySlug('pro-10-100');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'room-cancelled',
        currentRound: expect.objectContaining({
          id: 'round-cancelled',
          status: RoundStatus.CANCELLED,
          phase: 'RESULT',
          resultReason: 'SKIPPED_EMPTY',
        }),
      }),
      expect.objectContaining({
        id: 'room-completed',
        currentRound: expect.objectContaining({
          id: 'round-completed',
          status: RoundStatus.COMPLETED,
          phase: 'RESULT',
          resultReason: 'WINNER',
          winnerEntryId: 'entry-winner',
        }),
      }),
    ]);
  });

  it('uses a short skipped-empty result window in room summaries', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service } = buildService([
      {
        roomId: 'room-cancelled',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-C',
        roomName: 'Pro C',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-cancelled',
        roundNumber: 21,
        roundStatus: RoundStatus.CANCELLED,
        roundLocksAt: new Date('2026-05-30T11:59:00.000Z'),
        roundLockedAt: null,
        roundDrawingAt: null,
        roundSpinningAt: null,
        roundSettlingAt: null,
        roundWinnerEntryId: null,
        roundCompletedAt: null,
        roundCancelledAt: now,
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 0,
        playerCount: 0,
        liveEntryAmount: 0n,
      },
    ]);

    const result = await service.findActiveByCategorySlug('pro-10-100');

    expect(result[0].currentRound).toEqual(
      expect.objectContaining({
        status: RoundStatus.CANCELLED,
        resultReason: 'SKIPPED_EMPTY',
        msUntilPhaseEnd: 1_500,
        msUntilNextRound: 1_500,
      }),
    );
  });

  it('keeps normal completed winner result summaries longer', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service } = buildService([
      {
        roomId: 'room-completed',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-D',
        roomName: 'Pro D',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-completed',
        roundNumber: 22,
        roundStatus: RoundStatus.COMPLETED,
        roundLocksAt: new Date('2026-05-30T11:59:00.000Z'),
        roundLockedAt: new Date('2026-05-30T11:59:00.000Z'),
        roundDrawingAt: new Date('2026-05-30T11:59:02.000Z'),
        roundSpinningAt: new Date('2026-05-30T11:59:03.000Z'),
        roundSettlingAt: new Date('2026-05-30T11:59:08.000Z'),
        roundWinnerEntryId: 'entry-winner',
        roundCompletedAt: now,
        roundCancelledAt: null,
        roundTotalEntryAmount: 300n,
        roundPayoutAmount: 300n,
        entryCount: 2,
        playerCount: 2,
        liveEntryAmount: 300n,
      },
    ]);

    const result = await service.findActiveByCategorySlug('pro-10-100');

    expect(result[0].currentRound).toEqual(
      expect.objectContaining({
        status: RoundStatus.COMPLETED,
        resultReason: 'WINNER',
        msUntilPhaseEnd: 9_000,
        msUntilNextRound: 9_000,
      }),
    );
  });

  it('patches cached summaries when the machine starts the next open round', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service, prisma } = buildService([
      {
        roomId: 'room-open',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-A',
        roomName: 'Pro A',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-old',
        roundNumber: 7,
        roundStatus: RoundStatus.OPEN,
        roundLocksAt: new Date('2026-05-30T11:59:55.000Z'),
        roundLockedAt: null,
        roundDrawingAt: null,
        roundSpinningAt: null,
        roundSettlingAt: null,
        roundWinnerEntryId: null,
        roundCompletedAt: null,
        roundCancelledAt: null,
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 0,
        playerCount: 0,
        liveEntryAmount: 0n,
      },
    ]);

    await service.findActiveByCategorySlug('pro-10-100');
    const patched = service.patchLiveRoomSummaryCacheWithOpenRound(
      'room-open',
      {
        id: 'round-new',
        roomId: 'room-open',
        roundNumber: 8,
        status: RoundStatus.OPEN,
        totalEntryAmount: '0',
        houseFeeAmount: '0',
        payoutAmount: '0',
        openedAt: now.toISOString(),
        locksAt: new Date('2026-05-30T12:00:45.000Z').toISOString(),
        lockedAt: null,
        drawingAt: null,
        spinningAt: null,
        settlingAt: null,
        completedAt: null,
        cancelledAt: null,
        serverSeedHash: 'hash-new',
        winningTicket: null,
        winnerUserId: null,
        winnerEntryId: null,
        spinAngle: null,
      },
    );

    const result = await service.findActiveByCategorySlug('pro-10-100');

    expect(patched).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result[0].currentRound).toEqual(
      expect.objectContaining({
        id: 'round-new',
        roundNumber: 8,
        status: RoundStatus.OPEN,
        phaseLabel: 'ENTRY OPEN',
        msUntilLock: 45_000,
        entryCount: 0,
        playerCount: 0,
      }),
    );
  });

  it('does not start background summary refreshes for stale overdue open rounds', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service, prisma } = buildService([
      {
        roomId: 'room-open',
        roomCategoryId: 'category-1',
        roomCode: 'PRO-A',
        roomName: 'Pro A',
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: 'FLEXIBLE_PROPORTIONAL',
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 15,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: now,
        categorySlug: 'pro-10-100',
        categoryName: 'Pro 10-100',
        roundId: 'round-old',
        roundNumber: 7,
        roundStatus: RoundStatus.OPEN,
        roundLocksAt: new Date('2026-05-30T11:59:59.000Z'),
        roundLockedAt: null,
        roundDrawingAt: null,
        roundSpinningAt: null,
        roundSettlingAt: null,
        roundWinnerEntryId: null,
        roundCompletedAt: null,
        roundCancelledAt: null,
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 0,
        playerCount: 0,
        liveEntryAmount: 0n,
      },
    ]);

    await service.findActiveByCategorySlug('pro-10-100');
    jest.advanceTimersByTime(2_100);

    const result = await service.findActiveByCategorySlug('pro-10-100');

    expect(result[0].currentRound).toEqual(
      expect.objectContaining({
        status: RoundStatus.OPEN,
        phaseLabel: 'ENTRY OPEN',
        msUntilLock: 0,
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
