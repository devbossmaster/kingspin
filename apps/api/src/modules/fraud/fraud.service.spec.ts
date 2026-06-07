import { RiskEventSeverity, RiskEventStatus } from '@kingspin/db';
import { FraudService } from './fraud.service';

function riskEvent(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-05-28T12:00:00.000Z');

  return {
    id: 'risk-1',
    userId: 'user-1',
    roomId: 'room-1',
    roundId: 'round-1',
    type: 'DUPLICATE_IP_BETTING',
    severity: 'MEDIUM',
    status: 'OPEN',
    score: 45,
    summary: 'Risk event requires review.',
    reason: null,
    relatedType: 'ROUND',
    relatedId: 'round-1',
    ipHash: null,
    userAgentHash: null,
    deviceHash: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    reviewedByAdminId: null,
    reviewedAt: null,
    reviewNote: null,
    dismissedAt: null,
    dismissedBy: null,
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    riskEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          riskEvent({
            id: 'risk-created',
            ...data,
            createdAt: new Date('2026-05-28T12:00:00.000Z'),
            updatedAt: new Date('2026-05-28T12:00:00.000Z'),
            reviewedByAdminId: null,
            reviewedAt: null,
            reviewNote: null,
            dismissedAt: null,
            dismissedBy: null,
          }),
        ),
      ),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          riskEvent({
            id: 'risk-existing',
            ...data,
            createdAt: new Date('2026-05-28T12:00:00.000Z'),
            updatedAt: new Date('2026-05-28T12:00:00.000Z'),
          }),
        ),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    riskSignal: {
      create: jest.fn().mockResolvedValue({ id: 'signal-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    round: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    entry: {
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    paymentVerificationAttempt: {
      count: jest.fn().mockResolvedValue(0),
    },
    withdrawal: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: 0n },
        _count: 0,
      }),
    },
    depositIntent: {
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  };
}

describe('FraudService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows entry attempts below the rapid-entry threshold', async () => {
    const service = new FraudService(buildPrisma() as never);

    const result = await service.evaluateEntryAttempt({
      userId: 'user-1',
      roomId: 'room-1',
      roundId: 'round-1',
      amount: 1_000n,
      ipAddress: '127.0.0.1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        decision: 'ALLOW',
        findings: [],
        plannedChecks: expect.arrayContaining([
          expect.objectContaining({ check: 'DUPLICATE_IP_BETTING' }),
          expect.objectContaining({ check: 'REPEATED_WINNER_ANOMALY' }),
          expect.objectContaining({ check: 'MULTI_ACCOUNT_PATTERN' }),
        ]),
      }),
    );
  });

  it('blocks rapid entry attempts above the threshold and creates a review event', async () => {
    const prisma = buildPrisma();
    const service = new FraudService(prisma as never);

    for (let index = 0; index < 4; index += 1) {
      await expect(
        service.evaluateEntryAttempt({
          userId: 'user-1',
          roomId: 'room-1',
          roundId: 'round-1',
          amount: 1_000n,
        }),
      ).resolves.toEqual(expect.objectContaining({ decision: 'ALLOW' }));
    }

    const result = await service.evaluateEntryAttempt({
      userId: 'user-1',
      roomId: 'room-1',
      roundId: 'round-1',
      amount: 1_000n,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.findings).toEqual([
      expect.objectContaining({
        check: 'RAPID_ENTRY_ATTEMPTS',
        severity: 'HIGH',
        metadata: expect.objectContaining({
          count: 5,
          threshold: 4,
          windowMs: 15_000,
        }),
      }),
    ]);
    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ENTRY_RATE_LIMIT_HIT',
          status: 'OPEN',
        }),
      }),
    );
  });

  it('scopes rapid entry attempts by user and round', async () => {
    const service = new FraudService(buildPrisma() as never);

    for (let index = 0; index < 4; index += 1) {
      await service.evaluateEntryAttempt({
        userId: 'user-1',
        roomId: 'room-1',
        roundId: 'round-1',
      });
    }

    await expect(
      service.evaluateEntryAttempt({
        userId: 'user-2',
        roomId: 'room-1',
        roundId: 'round-1',
      }),
    ).resolves.toEqual(expect.objectContaining({ decision: 'ALLOW' }));

    await expect(
      service.evaluateEntryAttempt({
        userId: 'user-1',
        roomId: 'room-1',
        roundId: 'round-2',
      }),
    ).resolves.toEqual(expect.objectContaining({ decision: 'ALLOW' }));
  });

  it('expires local rapid-entry buckets after the rolling window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
    const service = new FraudService(buildPrisma() as never);

    for (let index = 0; index < 4; index += 1) {
      await service.evaluateEntryAttempt({
        userId: 'user-1',
        roomId: 'room-1',
        roundId: 'round-1',
      });
    }

    jest.advanceTimersByTime(15_001);

    await expect(
      service.evaluateEntryAttempt({
        userId: 'user-1',
        roomId: 'room-1',
        roundId: 'round-1',
      }),
    ).resolves.toEqual(expect.objectContaining({ decision: 'ALLOW' }));
  });

  it('uses Redis for rapid-entry counters when available', async () => {
    const prisma = buildPrisma();
    const redis = {
      isAvailable: jest.fn().mockReturnValue(true),
      incr: jest.fn().mockResolvedValue(5),
    };
    const service = new FraudService(prisma as never, redis as never);

    const result = await service.evaluateEntryAttempt({
      userId: 'user-1',
      roomId: 'room-1',
      roundId: 'round-1',
    });

    expect(redis.incr).toHaveBeenCalledWith(
      'fraud:rapid-entry:round-1:user-1',
      15_000,
    );
    expect(result.decision).toBe('BLOCK');
  });

  it('creates duplicate IP same-round risk without blocking entries', async () => {
    const prisma = buildPrisma();
    prisma.riskSignal.findMany.mockResolvedValue([
      { userId: 'user-1', relatedId: 'entry-1', roundId: 'round-1' },
      { userId: 'user-2', relatedId: 'entry-2', roundId: 'round-1' },
    ]);
    const service = new FraudService(prisma as never);

    await service.evaluateEntryPlacement({
      userId: 'user-2',
      roomId: 'room-1',
      roundId: 'round-1',
      entryId: 'entry-2',
      amount: 100n,
      ipAddress: '203.0.113.10',
      userAgent: 'Mozilla test',
    });

    expect(prisma.riskSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ENTRY_PLACED',
          ipHash: expect.any(String),
        }),
      }),
    );
    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'DUPLICATE_IP_BETTING',
          severity: 'MEDIUM',
          relatedType: 'ROUND',
          relatedId: 'round-1',
        }),
      }),
    );
  });

  it('creates grouped multi-account pattern risk from linked signals', async () => {
    const prisma = buildPrisma();
    prisma.riskSignal.findMany
      .mockResolvedValueOnce([
        { userId: 'user-1', relatedId: 'entry-1', roundId: 'round-1' },
        { userId: 'user-2', relatedId: 'entry-2', roundId: 'round-1' },
      ])
      .mockResolvedValueOnce([
        { userId: 'user-1', relatedId: 'entry-1', roundId: 'round-1' },
        { userId: 'user-2', relatedId: 'entry-2', roundId: 'round-1' },
        { userId: 'user-3', relatedId: 'entry-3', roundId: 'round-2' },
      ]);
    const service = new FraudService(prisma as never);

    await service.evaluateEntryPlacement({
      userId: 'user-3',
      roomId: 'room-1',
      roundId: 'round-2',
      entryId: 'entry-3',
      amount: 100n,
      ipAddress: '203.0.113.10',
    });

    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'DUPLICATE_IP_BETTING',
        }),
      }),
    );
    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'MULTI_ACCOUNT_PATTERN',
          severity: 'HIGH',
          relatedType: 'USER_GROUP',
          metadata: expect.objectContaining({
            linkedUserIds: ['user-1', 'user-2', 'user-3'],
            relatedRounds: ['round-1', 'round-2'],
          }),
        }),
      }),
    );
  });

  it('creates repeated winner anomaly risk only and does not modify the round', async () => {
    const prisma = buildPrisma();
    prisma.round.findUnique.mockResolvedValue({
      id: 'round-1',
      roomId: 'room-1',
      status: 'COMPLETED',
      winnerUserId: 'user-1',
      payoutAmount: 20_000n,
      completedAt: new Date('2026-05-28T12:00:00.000Z'),
    });
    prisma.round.count.mockResolvedValue(3);
    prisma.entry.count.mockResolvedValue(3);
    prisma.user.findUnique.mockResolvedValue({
      createdAt: new Date('2026-05-28T06:00:00.000Z'),
    });
    const service = new FraudService(prisma as never);

    await service.evaluateRoundWinner('round-1');

    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'REPEATED_WINNER_ANOMALY',
          relatedType: 'ROUND',
          relatedId: 'round-1',
          metadata: expect.objectContaining({ reviewOnly: true }),
        }),
      }),
    );
    expect(prisma.round.findUnique).toHaveBeenCalled();
    expect((prisma.round as any).update).toBeUndefined();
  });

  it('creates duplicate receipt risk and preserves no-credit behavior at fraud layer', async () => {
    const prisma = buildPrisma();
    const service = new FraudService(prisma as never);

    await service.evaluateDepositAttempt({
      userId: 'user-2',
      depositIntentId: 'intent-2',
      receiptNo: 'ABC123',
      status: 'DUPLICATE_RECEIPT',
      reason: 'Receipt number has already been used.',
      metadata: { existingUserId: 'user-1' },
    });

    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'DUPLICATE_PAYMENT_RECEIPT',
          severity: 'HIGH',
          relatedType: 'DEPOSIT_INTENT',
          relatedId: 'intent-2',
        }),
      }),
    );
  });

  it('creates many failed receipt attempts risk', async () => {
    const prisma = buildPrisma();
    prisma.paymentVerificationAttempt.count.mockResolvedValue(5);
    const service = new FraudService(prisma as never);

    await service.evaluateDepositAttempt({
      userId: 'user-1',
      depositIntentId: 'intent-1',
      receiptNo: 'BAD123',
      status: 'FAILED_ATTEMPT',
      reason: 'Receipt amount does not match.',
    });

    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'MANY_FAILED_RECEIPTS',
          severity: 'HIGH',
          score: 82,
        }),
      }),
    );
  });

  it('creates suspicious withdrawal risk for recent deposits and repeated requests', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue({
      createdAt: new Date('2026-05-28T06:00:00.000Z'),
    });
    prisma.withdrawal.aggregate.mockResolvedValue({
      _sum: { amount: 3000n },
      _count: 3,
    });
    prisma.depositIntent.count.mockResolvedValue(1);
    const service = new FraudService(prisma as never);

    await service.evaluateWithdrawalRequest({
      userId: 'user-1',
      withdrawalId: 'withdrawal-1',
      amount: 1000n,
      requestedAt: new Date('2026-05-28T12:00:00.000Z'),
      destination: { phone: '+251900000000' },
    });

    expect(prisma.riskSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WITHDRAWAL_REQUESTED',
          deviceHash: expect.any(String),
        }),
      }),
    );
    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'WITHDRAWAL_AFTER_NEW_DEPOSIT',
          relatedType: 'WITHDRAWAL',
          relatedId: 'withdrawal-1',
        }),
      }),
    );
  });

  it('updates an existing open risk event instead of spamming duplicates', async () => {
    const existing = riskEvent({
      id: 'risk-existing',
      severity: RiskEventSeverity.MEDIUM,
      score: 40,
      metadata: { evidenceCount: 1 },
    });
    const prisma = buildPrisma();
    prisma.riskEvent.findFirst.mockResolvedValue(existing);
    const service = new FraudService(prisma as never);

    await service.createRiskEvent({
      userId: 'user-1',
      roundId: 'round-1',
      type: 'DUPLICATE_IP_BETTING',
      severity: 'HIGH',
      score: 70,
      relatedType: 'ROUND',
      relatedId: 'round-1',
      metadata: { evidenceCount: 2 },
    });

    expect(prisma.riskEvent.create).not.toHaveBeenCalled();
    expect(prisma.riskEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'risk-existing' },
        data: expect.objectContaining({
          severity: 'HIGH',
          score: 70,
        }),
      }),
    );
  });

  it('masks sensitive metadata in API snapshots', async () => {
    const prisma = buildPrisma();
    const service = new FraudService(prisma as never);

    const event = await service.createRiskEvent({
      userId: 'user-1',
      type: 'MANUAL_FLAG',
      severity: 'LOW',
      metadata: {
        ipAddress: '203.0.113.1',
        email: 'person@example.com',
        phone: '+251900000000',
        rawHtml: '<html>secret</html>',
      },
    });

    expect(event.metadata).toEqual(
      expect.objectContaining({
        ipAddress: '[redacted]',
        email: 'pe***@example.com',
        phone: '+25***00',
        rawHtml: '[redacted]',
      }),
    );
  });

  it('records review notes and dismissal metadata', async () => {
    const prisma = buildPrisma();
    prisma.riskEvent.findUnique = jest.fn().mockResolvedValue(riskEvent());
    const service = new FraudService(prisma as never);

    await service.reviewRiskEvent(
      'risk-1',
      'admin-1',
      RiskEventStatus.DISMISSED,
      'False positive',
    );

    expect(prisma.riskEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISMISSED',
          reviewNote: 'False positive',
          dismissedBy: 'admin-1',
          dismissedAt: expect.any(Date),
        }),
      }),
    );
  });
});
