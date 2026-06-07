import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GameMode, RoundStatus } from '@kingspin/db';
import { EntriesService } from './entries.service';

const now = new Date('2026-05-26T12:00:00.000Z');

function buildPlacementRow(overrides?: Record<string, unknown>) {
  return {
    status: 'SUCCESS',
    reused: false,
    existingEntryAmount: null,
    walletBalanceSnapshot: 9_000n,
    gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
    categoryMinEntryAmount: 1_000n,
    categoryMaxEntryAmount: 5_000n,
    userId: 'user-1',
    userEmail: 'dev+player-1@kingspin.local',
    userUsername: 'dev_player-1',
    userFullName: 'Dev Player player-1',
    entryId: 'entry-1',
    entryRoundId: 'round-1',
    entryUserId: 'user-1',
    entryAmount: 1_000n,
    entryTicketStart: null,
    entryTicketEnd: null,
    entryIsWinner: false,
    entryCreatedAt: now,
    entryUpdatedAt: now,
    walletId: 'wallet-1',
    walletUserId: 'user-1',
    walletType: 'MAIN',
    walletCreatedAt: now,
    walletUpdatedAt: now,
    roundId: 'round-1',
    roundRoomId: 'room-1',
    roundNumber: 1,
    roundStatus: RoundStatus.OPEN,
    roundOpenedAt: now,
    roundLocksAt: new Date('2026-05-26T12:00:45.000Z'),
    roundLockedAt: null,
    roundDrawingAt: null,
    roundSpinningAt: null,
    roundSettlingAt: null,
    roundCompletedAt: null,
    roundCancelledAt: null,
    roundTotalEntryAmount: 1_000n,
    roundHouseFeeAmount: 0n,
    roundPayoutAmount: 1_000n,
    roundServerSeedHash: 'hash',
    roundServerSeedReveal: 'seed',
    roundFairnessAlgorithm: 'HMAC_SHA256_REJECTION_SAMPLING_V1',
    roundEntriesHash: null,
    roundDrawHash: null,
    roundDrawNonce: null,
    roundWinningTicket: null,
    roundWinnerUserId: null,
    roundWinnerEntryId: null,
    roundSpinAngle: null,
    roundIdempotencyKey: 'round:start:room-1:1',
    roundCreatedAt: now,
    roundUpdatedAt: now,
    ...overrides,
  };
}

function buildService(args?: {
  fraudService?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  placementRows?: Record<string, unknown>[];
}) {
  const prisma: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    round: {
      findFirst: jest.Mock;
    };
  } = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([buildPlacementRow(args?.placementRows?.[0])])
      .mockResolvedValueOnce([buildPlacementRow(args?.placementRows?.[1])]),
    $transaction: jest.fn(),
    round: {
      findFirst: jest.fn().mockResolvedValue({ id: 'round-1' }),
    },
  };

  prisma.$transaction.mockImplementation(
    async (callback: (txClient: typeof prisma) => unknown) => callback(prisma),
  );

  const roundsService = {
    toRoundSnapshot: jest.fn((round) => ({
      id: round.id,
      roomId: round.roomId,
      status: round.status,
      totalEntryAmount: round.totalEntryAmount.toString(),
      payoutAmount: round.payoutAmount.toString(),
    })),
    toLiveRoundSnapshot: jest.fn((round) => ({
      id: round.id,
      roomId: round.roomId,
      status: round.status,
      totalEntryAmount: round.totalEntryAmount.toString(),
      payoutAmount: round.payoutAmount.toString(),
      msUntilLock: 45_000,
      phase: 'ENTRY_OPEN',
      phaseLabel: 'ENTRY OPEN',
      msUntilPhaseEnd: 45_000,
      msUntilNextRound: null,
      resultReason: null,
    })),
  };

  return {
    service: new EntriesService(
      prisma as any,
      roundsService as any,
      args?.fraudService as any,
    ),
    prisma,
    roundsService,
  };
}

describe('EntriesService hot path', () => {
  it('first entry returns the authoritative debited wallet and round total', async () => {
    const { service, prisma } = buildService();

    const result = await service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 1_000,
      idempotencyKey: 'entry-key-1',
    });

    expect(result.reused).toBe(false);
    expect(result.wallet.balanceSnapshot).toBe('9000');
    expect(result.entry.amount).toBe('1000');
    expect(result.currentRound?.totalEntryAmount).toBe('1000');
    expect(result.player.id).toBe('user-1');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const hotPathSql =
      prisma.$queryRaw.mock.calls[0]?.[0]?.strings?.join(' ') ??
      String(prisma.$queryRaw.mock.calls[0]?.[0] ?? '');
    expect(hotPathSql).toContain('pg_advisory_xact_lock_shared');
    expect(hotPathSql).toContain("AT TIME ZONE 'UTC'");
    expect(hotPathSql).not.toContain('UPDATE rounds r');
  });

  it('blocks a fraud-denied entry before placement SQL runs', async () => {
    const fraudService = {
      evaluateEntryAttempt: jest.fn().mockResolvedValue({
        decision: 'BLOCK',
        findings: [
          {
            check: 'RAPID_ENTRY_ATTEMPTS',
            severity: 'HIGH',
            message:
              'Too many entry attempts for this round in a short window.',
          },
        ],
        plannedChecks: [],
        evaluatedAt: now.toISOString(),
      }),
    };
    const { service, prisma } = buildService({ fraudService });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 1_000,
        idempotencyKey: 'entry-key-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.round.findFirst).toHaveBeenCalledWith({
      where: {
        roomId: 'room-1',
        status: RoundStatus.OPEN,
        OR: [{ locksAt: null }, { locksAt: { gt: expect.any(Date) } }],
      },
      orderBy: { roundNumber: 'desc' },
      select: { id: true },
    });
    expect(fraudService.evaluateEntryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        roomId: 'room-1',
        roundId: 'round-1',
        amount: 1_000n,
      }),
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('top-up increments the existing entry and round total by the request amount', async () => {
    const { service } = buildService({
      placementRows: [
        {
          existingEntryAmount: 1_000n,
          walletBalanceSnapshot: 8_000n,
          entryAmount: 3_000n,
          roundTotalEntryAmount: 3_000n,
          roundPayoutAmount: 3_000n,
        },
      ],
    });

    const result = await service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 2_000,
      idempotencyKey: 'entry-key-2',
    });

    expect(result.entry.amount).toBe('3000');
    expect(result.wallet.balanceSnapshot).toBe('8000');
    expect(result.currentRound?.totalEntryAmount).toBe('3000');
  });

  it.each([10, 50, 100])(
    'pro flexible mode accepts %s within the configured range',
    async (amount) => {
      const { service } = buildService({
        preflight: {
          categoryMinEntryAmount: 10n,
          categoryMaxEntryAmount: 100n,
        },
        placementRows: [
          {
            walletBalanceSnapshot: BigInt(1_000 - amount),
            entryAmount: BigInt(amount),
            roundTotalEntryAmount: BigInt(amount),
            roundPayoutAmount: BigInt(amount),
          },
        ],
      });

      const result = await service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount,
        idempotencyKey: `pro-entry-${amount}`,
      });

      expect(result.entry.amount).toBe(String(amount));
      expect(result.currentRound?.totalEntryAmount).toBe(String(amount));
    },
  );

  it.each([
    { amount: 9, status: 'ENTRY_BELOW_MIN', message: 'below category minimum' },
    {
      amount: 101,
      status: 'ENTRY_ABOVE_MAX',
      message: 'above category maximum',
    },
  ])(
    'pro flexible mode rejects $amount outside the configured range',
    async (caseData) => {
      const { service } = buildService({
        preflight: {
          categoryMinEntryAmount: 10n,
          categoryMaxEntryAmount: 100n,
        },
        placementRows: [
          {
            status: caseData.status,
            entryId: null,
            roundId: null,
          },
        ],
      });

      await expect(
        service.placeEntryForUser({
          roomId: 'room-1',
          userId: 'user-1',
          amount: caseData.amount,
          idempotencyKey: `pro-entry-${caseData.amount}`,
        }),
      ).rejects.toThrow(caseData.message);
    },
  );

  it('duplicate idempotency replay returns the existing result without another debit', async () => {
    const { service, prisma } = buildService({
      placementRows: [
        {
          status: 'REPLAY',
          reused: true,
          walletBalanceSnapshot: 9_000n,
          entryAmount: 1_000n,
          roundTotalEntryAmount: 1_000n,
        },
      ],
    });

    const result = await service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 1_000,
      idempotencyKey: 'entry-key-1',
    });

    expect(result.reused).toBe(true);
    expect(result.wallet.balanceSnapshot).toBe('9000');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('idempotency key reused with different request details fails safely', async () => {
    const { service } = buildService({
      placementRows: [{ status: 'IDEMPOTENCY_MISMATCH' }],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 2_000,
        idempotencyKey: 'entry-key-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('insufficient balance creates no committed entry response or ledger drift', async () => {
    const { service, prisma } = buildService({
      preflight: { walletBalanceSnapshot: 500n },
      placementRows: [
        {
          status: 'INSUFFICIENT_BALANCE',
          walletBalanceSnapshot: 500n,
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 1_000,
        idempotencyKey: 'entry-key-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('round not OPEN rejects inside the compact transaction', async () => {
    const { service } = buildService({
      placementRows: [
        {
          status: 'ROUND_NOT_OPEN',
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 1_000,
        idempotencyKey: 'entry-key-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fixed equal-chance mode rejects custom amounts inside the transaction', async () => {
    const { service } = buildService({
      preflight: {
        roomGameMode: 'FIXED_EQUAL_CHANCE',
        roomFixedEntryAmount: 1_000n,
      },
      placementRows: [
        {
          status: 'FIXED_ENTRY_AMOUNT_MISMATCH',
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 2_000,
        idempotencyKey: 'fixed-entry-key-1',
      }),
    ).rejects.toThrow('exact configured entry amount');
  });

  it('fixed equal-chance mode accepts exactly the configured amount', async () => {
    const { service } = buildService({
      preflight: {
        roomGameMode: 'FIXED_EQUAL_CHANCE',
        roomFixedEntryAmount: 10n,
        categoryMinEntryAmount: 10n,
        categoryMaxEntryAmount: 10n,
      },
      placementRows: [
        {
          entryAmount: 10n,
          walletBalanceSnapshot: 90n,
          roundTotalEntryAmount: 10n,
          roundPayoutAmount: 10n,
        },
      ],
    });

    const result = await service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 10,
      idempotencyKey: 'fixed-entry-key-exact',
    });

    expect(result.entry.amount).toBe('10');
    expect(result.reused).toBe(false);
  });

  it.each([9, 11, 20])(
    'fixed equal-chance mode rejects custom amount %s',
    async (amount) => {
      const { service } = buildService({
        preflight: {
          roomGameMode: 'FIXED_EQUAL_CHANCE',
          roomFixedEntryAmount: 10n,
          categoryMinEntryAmount: 10n,
          categoryMaxEntryAmount: 10n,
        },
        placementRows: [
          {
            status: 'FIXED_ENTRY_AMOUNT_MISMATCH',
            entryId: null,
            roundId: null,
          },
        ],
      });

      await expect(
        service.placeEntryForUser({
          roomId: 'room-1',
          userId: 'user-1',
          amount,
          idempotencyKey: `fixed-entry-key-${amount}`,
        }),
      ).rejects.toThrow('exact configured entry amount');
    },
  );

  it('fixed equal-chance mode rejects top-ups inside the transaction', async () => {
    const { service } = buildService({
      preflight: {
        roomGameMode: 'FIXED_EQUAL_CHANCE',
        roomFixedEntryAmount: 1_000n,
      },
      placementRows: [
        {
          status: 'FIXED_TOP_UP_NOT_ALLOWED',
          existingEntryAmount: 1_000n,
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 1_000,
        idempotencyKey: 'fixed-entry-key-2',
      }),
    ).rejects.toThrow('does not allow top-ups');
  });

  it('same-key concurrent double click resolves as one write plus one replay', async () => {
    const { service, prisma } = buildService({
      placementRows: [
        {
          status: 'SUCCESS',
          reused: false,
          walletBalanceSnapshot: 9_000n,
        },
        {
          status: 'REPLAY',
          reused: true,
          walletBalanceSnapshot: 9_000n,
        },
      ],
    });

    const first = service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 1_000,
      idempotencyKey: 'entry-key-1',
    });
    const second = service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 1_000,
      idempotencyKey: 'entry-key-1',
    });

    const results = await Promise.all([first, second]);

    expect(results.map((result) => result.reused)).toEqual([false, true]);
    expect(results.map((result) => result.wallet.balanceSnapshot)).toEqual([
      '9000',
      '9000',
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('fixed mode idempotency replay returns the existing entry without another debit', async () => {
    const { service, prisma } = buildService({
      preflight: {
        roomGameMode: 'FIXED_EQUAL_CHANCE',
        roomFixedEntryAmount: 10n,
        categoryMinEntryAmount: 10n,
        categoryMaxEntryAmount: 10n,
      },
      placementRows: [
        {
          status: 'REPLAY',
          reused: true,
          entryAmount: 10n,
          walletBalanceSnapshot: 90n,
          roundTotalEntryAmount: 10n,
          roundPayoutAmount: 10n,
        },
      ],
    });

    const result = await service.placeEntryForUser({
      roomId: 'room-1',
      userId: 'user-1',
      amount: 10,
      idempotencyKey: 'fixed-entry-key-replay',
    });

    expect(result.reused).toBe(true);
    expect(result.wallet.balanceSnapshot).toBe('90');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('single statement rejects rooms without an OPEN round without money writes', async () => {
    const { service, prisma } = buildService({
      placementRows: [
        {
          status: 'ROUND_NOT_OPEN',
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 1_000,
        idempotencyKey: 'entry-key-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('locked fixed mode rejects inside the single statement when there is no OPEN round', async () => {
    const { service, prisma } = buildService({
      placementRows: [
        {
          status: 'ROUND_NOT_OPEN',
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 10,
        idempotencyKey: 'fixed-locked-entry',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects entries after a round is no longer OPEN inside the single statement', async () => {
    const { service, prisma } = buildService({
      placementRows: [
        {
          status: 'ROUND_NOT_OPEN',
          entryId: null,
          roundId: null,
        },
      ],
    });

    await expect(
      service.placeEntryForUser({
        roomId: 'room-1',
        userId: 'user-1',
        amount: 1_000,
        idempotencyKey: 'locked-entry-key',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
