import {
  RiskEventSeverity,
  RiskEventStatus,
  RiskEventType,
  RoundStatus,
} from '@kingspin/db';
import { AdminOperationsService } from './admin-operations.service';

describe('AdminOperationsService', () => {
  const round = {
    count: jest.fn(),
    findMany: jest.fn(),
  };
  const riskEvent = {
    count: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = { round, riskEvent };
  const service = new AdminOperationsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    round.count.mockResolvedValue(1);
    riskEvent.count.mockResolvedValue(1);
    riskEvent.findMany.mockResolvedValue([]);
  });

  it('caps page size and hides an unrevealed server seed', async () => {
    round.findMany.mockResolvedValue([
      {
        id: 'round-1',
        roundNumber: 7,
        status: RoundStatus.OPEN,
        totalEntryAmount: 100n,
        payoutAmount: 0n,
        winnerUserId: null,
        openedAt: new Date('2026-06-05T08:00:00.000Z'),
        locksAt: null,
        lockedAt: null,
        drawingAt: null,
        spinningAt: null,
        settlingAt: null,
        completedAt: null,
        cancelledAt: null,
        serverSeedHash: 'public-hash',
        serverSeedReveal: 'private-seed',
        room: { id: 'room-1', code: 'A01', name: 'Arena 1' },
        _count: { entries: 1 },
      },
    ]);

    const result = await service.listRounds({ pageSize: '999' });

    expect(round.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
    expect(result.items[0]).toMatchObject({
      serverSeedHash: 'public-hash',
      revealStatus: 'HIDDEN',
      serverSeedReveal: null,
    });
  });

  it('sanitizes risk event DTOs and caps risk page size', async () => {
    riskEvent.findMany.mockResolvedValue([
      {
        id: 'risk-1',
        userId: 'user-1',
        roomId: null,
        roundId: null,
        type: RiskEventType.DUPLICATE_PAYMENT_RECEIPT,
        severity: RiskEventSeverity.HIGH,
        status: RiskEventStatus.OPEN,
        score: 90,
        summary: null,
        reason: 'duplicate receipt',
        relatedType: 'DEPOSIT_INTENT',
        relatedId: 'deposit-1',
        metadata: {
          safe: 'visible',
          ipHash: 'hidden-ip-hash',
          userAgent: 'hidden-user-agent',
          nested: {
            safe: 'nested-visible',
            rawHtml: '<html>receipt</html>',
          },
        },
        createdAt: new Date('2026-06-05T08:00:00.000Z'),
        reviewedAt: null,
        reviewNote: null,
        dismissedAt: null,
        user: { username: 'player', displayUsername: null },
      },
    ]);

    const result = await service.listRiskEvents({ pageSize: '999' });

    expect(riskEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        select: expect.not.objectContaining({
          ipHash: true,
          userAgentHash: true,
          deviceHash: true,
        }),
      }),
    );
    expect(result.items[0]).not.toHaveProperty('ipHash');
    expect(result.items[0]).not.toHaveProperty('userAgentHash');
    expect(result.items[0]).not.toHaveProperty('deviceHash');
    expect(result.items[0].metadata).toEqual({
      safe: 'visible',
      nested: { safe: 'nested-visible' },
    });
  });
});
