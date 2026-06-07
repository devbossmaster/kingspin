import {
  RiskEventSeverity,
  RiskEventStatus,
  RiskEventType,
  RoundStatus,
} from '@kingspin/db';
import { FAIRNESS_ALGORITHM } from '@kingspin/game-engine';
import { AdminOperationsService } from './admin-operations.service';

const serverSeed =
  '375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d';
const serverSeedHash =
  'f9b0b3d8ae33d8b443f21916c18f5633b4a2aca2814cec3c14e67971250f367c';
const entriesHash =
  '425d3f746b8c9858ea14a98433ecffbe7eaae92305781c636a80be6e96097850';
const drawHash =
  '7f7cd80fcc95aef291cb43f849ace4dfb4a1cd15ff2e84f41d6fd041ec6cbc20';

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
        fairnessAlgorithm: FAIRNESS_ALGORITHM,
        entriesHash: null,
        drawHash: null,
        drawNonce: null,
        winningTicket: null,
        winnerEntryId: null,
        entries: [],
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
      verificationStatus: 'PENDING',
    });
  });

  it('reveals and verifies a completed round fairness proof', async () => {
    round.findMany.mockResolvedValue([
      {
        id: 'cmpmhquq2000gcfq01znqehcp',
        roundNumber: 2,
        status: RoundStatus.COMPLETED,
        totalEntryAmount: 3_500n,
        payoutAmount: 3_500n,
        winnerUserId: 'user-b',
        winnerEntryId: 'b',
        winningTicket: 2_696n,
        openedAt: new Date('2026-06-05T08:00:00.000Z'),
        locksAt: new Date('2026-06-05T08:00:45.000Z'),
        lockedAt: new Date('2026-06-05T08:00:45.000Z'),
        drawingAt: new Date('2026-06-05T08:00:46.000Z'),
        spinningAt: new Date('2026-06-05T08:00:47.000Z'),
        settlingAt: new Date('2026-06-05T08:00:52.000Z'),
        completedAt: new Date('2026-06-05T08:00:53.000Z'),
        cancelledAt: null,
        serverSeedHash,
        serverSeedReveal: serverSeed,
        fairnessAlgorithm: FAIRNESS_ALGORITHM,
        entriesHash,
        drawHash,
        drawNonce: 0,
        entries: [
          {
            id: 'a',
            roundId: 'cmpmhquq2000gcfq01znqehcp',
            userId: 'user-a',
            amount: 1_500n,
            ticketStart: 0n,
            ticketEnd: 1_499n,
          },
          {
            id: 'b',
            roundId: 'cmpmhquq2000gcfq01znqehcp',
            userId: 'user-b',
            amount: 2_000n,
            ticketStart: 1_500n,
            ticketEnd: 3_499n,
          },
        ],
        room: { id: 'room-1', code: 'A01', name: 'Arena 1' },
        _count: { entries: 2 },
      },
    ]);

    const result = await service.listRounds({});

    expect(result.items[0]).toMatchObject({
      serverSeedReveal: serverSeed,
      revealStatus: 'REVEALED',
      entriesHash,
      winningTicket: '2696',
      winnerEntryId: 'b',
      winnerUserId: 'user-b',
      verificationStatus: 'VERIFIED',
      verificationWarning: null,
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
