import { FraudService } from './fraud.service';

describe('FraudService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows entry attempts below the rapid-entry threshold', async () => {
    const service = new FraudService({} as never);

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
          expect.objectContaining({ check: 'SUSPICIOUS_REPEATED_WINS' }),
          expect.objectContaining({ check: 'MULTI_ACCOUNT_PATTERN' }),
        ]),
      }),
    );
    expect(result.plannedChecks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'RAPID_ENTRY_ATTEMPTS' }),
      ]),
    );
  });

  it('blocks rapid entry attempts above the threshold for one user and round', async () => {
    const service = new FraudService({} as never);

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
  });

  it('scopes rapid entry attempts by user and round', async () => {
    const service = new FraudService({} as never);

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
    const service = new FraudService({} as never);

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
    const redis = {
      isAvailable: jest.fn().mockReturnValue(true),
      incr: jest.fn().mockResolvedValue(5),
    };
    const service = new FraudService({} as never, redis as never);

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

  it('creates risk events for admin review without auto-banning', async () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    const prisma = {
      riskEvent: {
        create: jest.fn().mockResolvedValue({
          id: 'risk-1',
          userId: 'user-1',
          roomId: 'room-1',
          roundId: null,
          type: 'IDEMPOTENCY_MISMATCH',
          severity: 'HIGH',
          status: 'OPEN',
          metadata: { idempotencyKey: 'key-1' },
          createdAt: now,
          reviewedByAdminId: null,
          reviewedAt: null,
        }),
      },
    };
    const service = new FraudService(prisma as never);

    const event = await service.createRiskEvent({
      userId: 'user-1',
      roomId: 'room-1',
      type: 'IDEMPOTENCY_MISMATCH',
      severity: 'HIGH',
      metadata: { idempotencyKey: 'key-1' },
    });

    expect(event.status).toBe('OPEN');
    expect(event.type).toBe('IDEMPOTENCY_MISMATCH');
    expect(prisma.riskEvent.create).toHaveBeenCalledTimes(1);
  });
});
