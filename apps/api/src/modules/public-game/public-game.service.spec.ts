import { RoundStatus } from '@kingspin/db';
import { PublicGameService } from './public-game.service';

const now = new Date('2026-05-26T12:00:00.000Z');

function buildLiveStateRows() {
  return [
    {
      roomId: 'room-1',
      roomCategoryId: 'category-1',
      roomCode: 'room-one',
      roomName: 'Room One',
      roomStatus: 'ACTIVE',
      roomIsPermanent: true,
      roomMaxPlayers: 20,
      roomRoundDurationMs: 45_000,
      roomActivatedAt: now,
      categoryId: 'category-1',
      categoryName: 'Starter',
      categorySlug: 'starter',
      categoryMinEntryAmount: 1_000n,
      categoryMaxEntryAmount: 5_000n,
      categoryMaxPlayers: 20,
      categoryRoundDurationMs: 45_000,
      roundId: 'round-1',
      roundRoomId: 'room-1',
      roundNumber: 1,
      roundStatus: RoundStatus.OPEN,
      roundTotalEntryAmount: 1_000n,
      roundHouseFeeAmount: 0n,
      roundPayoutAmount: 1_000n,
      roundOpenedAt: now,
      roundLocksAt: new Date('2026-05-26T12:00:45.000Z'),
      roundLockedAt: null,
      roundDrawingAt: null,
      roundSpinningAt: null,
      roundSettlingAt: null,
      roundCompletedAt: null,
      roundCancelledAt: null,
      roundServerSeedHash: 'hash',
      roundWinningTicket: null,
      roundWinnerUserId: null,
      roundWinnerEntryId: null,
      roundSpinAngle: null,
      entryId: 'entry-1',
      entryRoundId: 'round-1',
      entryUserId: 'user-1',
      entryAmount: 1_000n,
      entryTicketStart: null,
      entryTicketEnd: null,
      entryIsWinner: false,
      entryCreatedAt: now,
      entryUpdatedAt: now,
      entryPlayerId: 'user-1',
      entryPlayerUsername: 'dev_player-1',
      entryPlayerFullName: 'Dev Player player-1',
    },
  ];
}

function buildPrisma() {
  return {
    $queryRaw: jest.fn().mockResolvedValue(buildLiveStateRows()),
  };
}

describe('PublicGameService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('live-state after entry exposes updated pool and player entry', async () => {
    const prisma = buildPrisma();
    const service = new PublicGameService(prisma as any);

    const snapshot = await service.getRoomLiveState('room-1');

    expect(snapshot.currentRound?.totalEntryAmount).toBe('1000');
    expect(snapshot.currentRound?.payoutAmount).toBe('1000');
    expect(snapshot.currentRound).toEqual(
      expect.objectContaining({
        phase: 'ENTRY_OPEN',
        phaseLabel: 'ENTRY OPEN',
        resultReason: null,
      }),
    );
    expect(snapshot.entries).toEqual([
      expect.objectContaining({
        id: 'entry-1',
        userId: 'user-1',
        amount: '1000',
        player: expect.objectContaining({
          id: 'user-1',
          username: 'dev_player-1',
        }),
      }),
    ]);
  });

  it('derives OPEN round live pool from entry sums instead of stale round totals', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(
        buildLiveStateRows().map((row) => ({
          ...row,
          roundStatus: RoundStatus.OPEN,
          roundTotalEntryAmount: 0n,
          roundPayoutAmount: 0n,
        })),
      ),
    };
    const service = new PublicGameService(prisma as any);

    const snapshot = await service.getRoomLiveState('room-1');

    expect(snapshot.currentRound?.totalEntryAmount).toBe('1000');
    expect(snapshot.currentRound?.payoutAmount).toBe('1000');
  });

  it('keeps an active permanent room live-state non-null after a skipped round', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(
        buildLiveStateRows().map((row) => ({
          ...row,
          roundStatus: RoundStatus.CANCELLED,
          roundLocksAt: new Date('2026-05-26T11:59:00.000Z'),
          roundCancelledAt: new Date('2026-05-26T11:59:00.000Z'),
          roundTotalEntryAmount: 0n,
          roundPayoutAmount: 0n,
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
        })),
      ),
    };
    const service = new PublicGameService(prisma as any);

    const snapshot = await service.getRoomLiveState('room-1');

    expect(snapshot.currentRound).toEqual(
      expect.objectContaining({
        id: 'round-1',
        status: RoundStatus.CANCELLED,
        phase: 'RESULT',
        resultReason: 'SKIPPED_EMPTY',
      }),
    );
    expect(snapshot.entries).toEqual([]);
  });

  it('uses a short result display window for skipped empty rounds', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(
        buildLiveStateRows().map((row) => ({
          ...row,
          roundStatus: RoundStatus.CANCELLED,
          roundLocksAt: new Date('2026-05-26T11:59:00.000Z'),
          roundCancelledAt: now,
          roundTotalEntryAmount: 0n,
          roundPayoutAmount: 0n,
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
        })),
      ),
    };
    const service = new PublicGameService(prisma as any);

    const snapshot = await service.getRoomLiveState('room-1');

    expect(snapshot.currentRound).toEqual(
      expect.objectContaining({
        status: RoundStatus.CANCELLED,
        resultReason: 'SKIPPED_EMPTY',
        msUntilPhaseEnd: 1_500,
        msUntilNextRound: 1_500,
      }),
    );
  });

  it('keeps an active permanent room live-state non-null between completed cooldown and next OPEN', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(
        buildLiveStateRows().map((row) => ({
          ...row,
          roundStatus: RoundStatus.COMPLETED,
          roundLocksAt: new Date('2026-05-26T11:59:00.000Z'),
          roundCompletedAt: new Date('2026-05-26T11:59:00.000Z'),
          roundWinnerEntryId: 'entry-1',
          entryTicketStart: 0n,
          entryTicketEnd: 999n,
          entryIsWinner: true,
        })),
      ),
    };
    const service = new PublicGameService(prisma as any);

    const snapshot = await service.getRoomLiveState('room-1');

    expect(snapshot.currentRound).toEqual(
      expect.objectContaining({
        id: 'round-1',
        status: RoundStatus.COMPLETED,
        phase: 'RESULT',
        resultReason: 'WINNER',
        winnerEntryId: 'entry-1',
      }),
    );
  });

  it('keeps the normal completed winner result display window longer', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(
        buildLiveStateRows().map((row) => ({
          ...row,
          roundStatus: RoundStatus.COMPLETED,
          roundLocksAt: new Date('2026-05-26T11:59:00.000Z'),
          roundCompletedAt: now,
          roundWinnerEntryId: 'entry-1',
          entryTicketStart: 0n,
          entryTicketEnd: 999n,
          entryIsWinner: true,
        })),
      ),
    };
    const service = new PublicGameService(prisma as any);

    const snapshot = await service.getRoomLiveState('room-1');

    expect(snapshot.currentRound).toEqual(
      expect.objectContaining({
        status: RoundStatus.COMPLETED,
        resultReason: 'WINNER',
        msUntilPhaseEnd: 9_000,
        msUntilNextRound: 9_000,
      }),
    );
  });

  it('deduplicates in-flight snapshot generation per room', async () => {
    const prisma = buildPrisma();
    const service = new PublicGameService(prisma as any);

    await Promise.all([
      service.getRoomLiveState('room-1'),
      service.getRoomLiveState('room-1'),
    ]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('serves a tiny cached snapshot until the room is invalidated', async () => {
    const prisma = buildPrisma();
    const service = new PublicGameService(prisma as any);

    await service.getRoomLiveState('room-1');
    await service.getRoomLiveState('room-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);

    service.invalidateRoomLiveState('room-1');

    await service.getRoomLiveState('room-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
