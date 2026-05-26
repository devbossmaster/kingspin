import { BadRequestException } from "@nestjs/common";
import { LedgerTransactionType, RoundStatus } from "@kingspin/db";
import { EntriesService } from "./entries.service";

const now = new Date("2026-05-26T12:00:00.000Z");

function buildUser() {
  return {
    id: "user-1",
    email: "dev+player-1@kingspin.local",
    username: "dev_player-1",
    fullName: "Dev Player player-1",
    emailVerified: true,
    role: "PLAYER",
    image: null,
    bannedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildWallet(balanceSnapshot = 10_000n) {
  return {
    id: "wallet-1",
    userId: "user-1",
    type: "MAIN",
    balanceSnapshot,
    createdAt: now,
    updatedAt: now,
  };
}

function toWalletSnapshot(wallet = buildWallet()) {
  return {
    id: wallet.id,
    userId: wallet.userId,
    type: wallet.type,
    balanceSnapshot: wallet.balanceSnapshot.toString(),
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

function buildRound() {
  return {
    id: "round-1",
    roomId: "room-1",
    roundNumber: 1,
    status: RoundStatus.OPEN,
    openedAt: now,
    locksAt: new Date("2026-05-26T12:00:45.000Z"),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    totalEntryAmount: 0n,
    houseFeeAmount: 0n,
    payoutAmount: 0n,
    serverSeedHash: "hash",
    serverSeedReveal: "seed",
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
    idempotencyKey: "round:start:room-1:1",
    createdAt: now,
    updatedAt: now,
  };
}

function buildEntry(amount = 1_000n) {
  return {
    id: "entry-1",
    roundId: "round-1",
    userId: "user-1",
    amount,
    ticketStart: null,
    ticketEnd: null,
    isWinner: false,
    createdAt: now,
    updatedAt: now,
  };
}

function buildRoom() {
  return {
    id: "room-1",
    status: "ACTIVE",
    category: {
      isActive: true,
      minEntryAmount: 1_000n,
      maxEntryAmount: 5_000n,
    },
  };
}

function buildHoldSnapshot(entryId = "entry-1", amount = "1000") {
  return {
    id: "ledger-1",
    type: LedgerTransactionType.ENTRY_HOLD,
    referenceType: "ENTRY",
    referenceId: entryId,
    idempotencyKey: "entry-key-1",
    metadata: {
      userId: "user-1",
      roundId: "round-1",
      entryId,
      walletAccountId: "wallet-1",
      amount,
      holdState: "HELD",
    },
    createdAt: now.toISOString(),
    entries: [],
  };
}

function buildAppliedHoldTransaction(entryId = "entry-1", amount = "1000") {
  return {
    id: "ledger-1",
    type: LedgerTransactionType.ENTRY_HOLD,
    referenceType: "ENTRY",
    referenceId: entryId,
    metadata: {
      userId: "user-1",
      roundId: "round-1",
      entryId,
      walletAccountId: "wallet-1",
      amount,
      holdState: "APPLIED",
      appliedAt: now.toISOString(),
    },
  };
}

function buildRoundsService() {
  return {
    toRoundSnapshot: jest.fn((value) => ({
      id: value.id,
      status: value.status,
      totalEntryAmount: value.totalEntryAmount.toString(),
      payoutAmount: value.payoutAmount.toString(),
    })),
  };
}

function buildWriteTx(args?: {
  existingEntry?: ReturnType<typeof buildEntry> | null;
  updatedEntry?: ReturnType<typeof buildEntry>;
  roundUpdateCount?: number;
}) {
  const round = buildRound();
  const existingEntry = args?.existingEntry ?? null;
  const updatedEntry = args?.updatedEntry ?? buildEntry();

  return {
    entry: {
      findUnique: jest.fn().mockResolvedValue(existingEntry),
      create: jest.fn().mockResolvedValue(updatedEntry),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(updatedEntry),
    },
    round: {
      updateMany: jest.fn().mockResolvedValue({
        count: args?.roundUpdateCount ?? 1,
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...round,
        totalEntryAmount: updatedEntry.amount,
        payoutAmount: updatedEntry.amount,
      }),
    },
    ledgerTransaction: {
      update: jest.fn().mockResolvedValue({ id: "ledger-1" }),
    },
  };
}

describe("EntriesService", () => {
  it("places an entry with wallet hold outside the entry write transaction", async () => {
    const user = buildUser();
    const wallet = buildWallet();
    const round = buildRound();
    const entry = buildEntry();
    const tx = buildWriteTx({ updatedEntry: entry });

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(round),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest.fn().mockResolvedValue({
        wallet: toWalletSnapshot(buildWallet(9_000n)),
        transaction: buildHoldSnapshot(entry.id),
        reused: false,
      }),
      refundEntryHoldByIdempotencyKey: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    const result = await service.placeEntryForUser({
      roomId: "room-1",
      userId: user.id,
      amount: 1_000,
      idempotencyKey: "entry-key-1",
    });

    expect(result.reused).toBe(false);
    expect(result.entry.id).toBe("entry-1");
    expect(result.wallet.balanceSnapshot).toBe("9000");
    expect(walletsService.holdEntryAmountForEntry).toHaveBeenCalledWith({
      walletAccountId: wallet.id,
      userId: user.id,
      roundId: round.id,
      entryId: expect.any(String),
      amount: 1_000n,
      idempotencyKey: "entry-key-1",
    });
    expect(tx.round.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalEntryAmount: { increment: 1_000n },
          payoutAmount: { increment: 1_000n },
        }),
      }),
    );
    expect(tx.ledgerTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: "entry-key-1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            holdState: "APPLIED",
            entryAmountAfter: "1000",
          }),
        }),
      }),
    );
    expect(walletsService.refundEntryHoldByIdempotencyKey).not.toHaveBeenCalled();
  });

  it("uses only the authenticated user id for production-shaped entry placement", async () => {
    const user = buildUser();
    const wallet = buildWallet();
    const tx = buildWriteTx({ updatedEntry: buildEntry() });

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(buildRound()),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest.fn().mockResolvedValue({
        wallet: toWalletSnapshot(buildWallet(9_000n)),
        transaction: buildHoldSnapshot("entry-1"),
        reused: false,
      }),
      refundEntryHoldByIdempotencyKey: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    await service.placeEntryForUser({
      roomId: "room-1",
      userId: user.id,
      amount: 1_000,
      idempotencyKey: "entry-key-1",
      playerKey: "evil-player",
      walletId: "evil-wallet",
    } as any);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
    });
    expect(walletsService.holdEntryAmountForEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        walletAccountId: wallet.id,
      }),
    );
    expect(tx.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: user.id,
        }),
      }),
    );
  });

  it("replays an applied idempotency key without another hold or write transaction", async () => {
    const user = buildUser();
    const wallet = buildWallet(9_000n);
    const round = {
      ...buildRound(),
      totalEntryAmount: 1_000n,
      payoutAmount: 1_000n,
    };
    const entry = buildEntry();

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(round),
        findUniqueOrThrow: jest.fn().mockResolvedValue(round),
      },
      ledgerTransaction: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(buildAppliedHoldTransaction(entry.id))
          .mockResolvedValueOnce(null),
      },
      entry: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(entry),
      },
      walletAccount: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(wallet),
      },
      $transaction: jest.fn(),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    const result = await service.placeEntryForUser({
      roomId: "room-1",
      userId: user.id,
      amount: 1_000,
      idempotencyKey: "entry-key-1",
    });

    expect(result.reused).toBe(true);
    expect(walletsService.holdEntryAmountForEntry).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reuses the original entry id when retrying an unapplied wallet hold", async () => {
    const user = buildUser();
    const wallet = buildWallet(9_000n);
    const pendingHold = {
      ...buildAppliedHoldTransaction("entry-1"),
      metadata: {
        userId: user.id,
        roundId: "round-1",
        entryId: "entry-1",
        walletAccountId: wallet.id,
        amount: "1000",
        holdState: "HELD",
      },
    };
    const tx = buildWriteTx({ updatedEntry: buildEntry() });

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(buildRound()),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ledgerTransaction: {
        findUnique: jest.fn(({ where }: { where: { idempotencyKey: string } }) =>
          Promise.resolve(
            where.idempotencyKey === "entry-key-1" ? pendingHold : null,
          ),
        ),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest.fn().mockResolvedValue({
        wallet: toWalletSnapshot(wallet),
        transaction: buildHoldSnapshot("entry-1"),
        reused: true,
      }),
      refundEntryHoldByIdempotencyKey: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    await service.placeEntryForUser({
      roomId: "room-1",
      userId: user.id,
      amount: 1_000,
      idempotencyKey: "entry-key-1",
    });

    expect(walletsService.holdEntryAmountForEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: "entry-1",
      }),
    );
    expect(tx.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "entry-1",
        }),
      }),
    );
  });

  it("does not enter the entry write transaction when wallet hold fails", async () => {
    const user = buildUser();
    const wallet = buildWallet(500n);

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(buildRound()),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException("Insufficient MAIN wallet balance."),
        ),
      refundEntryHoldByIdempotencyKey: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    await expect(
      service.placeEntryForUser({
        roomId: "room-1",
        userId: user.id,
        amount: 1_000,
        idempotencyKey: "entry-key-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(walletsService.refundEntryHoldByIdempotencyKey).not.toHaveBeenCalled();
  });

  it("top-up mode increments by the requested amount only", async () => {
    const user = buildUser();
    const wallet = buildWallet();
    const existingEntry = buildEntry(1_000n);
    const updatedEntry = buildEntry(3_000n);
    const tx = buildWriteTx({
      existingEntry,
      updatedEntry,
    });

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue({
          ...buildRound(),
          totalEntryAmount: 1_000n,
          payoutAmount: 1_000n,
        }),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(existingEntry),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest.fn().mockResolvedValue({
        wallet: toWalletSnapshot(buildWallet(8_000n)),
        transaction: buildHoldSnapshot(existingEntry.id, "2000"),
        reused: false,
      }),
      refundEntryHoldByIdempotencyKey: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    const result = await service.placeEntryForUser({
      roomId: "room-1",
      userId: user.id,
      amount: 2_000,
      idempotencyKey: "entry-key-1",
    });

    expect(result.entry.amount).toBe("3000");
    expect(walletsService.holdEntryAmountForEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: existingEntry.id,
        amount: 2_000n,
      }),
    );
    expect(tx.entry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: { increment: 2_000n },
        }),
      }),
    );
    expect(tx.round.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalEntryAmount: { increment: 2_000n },
          payoutAmount: { increment: 2_000n },
        }),
      }),
    );
  });

  it("compensates the wallet hold when the entry write fails", async () => {
    const user = buildUser();
    const wallet = buildWallet();
    const tx = buildWriteTx({
      updatedEntry: buildEntry(),
      roundUpdateCount: 0,
    });

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(buildRound()),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet),
      holdEntryAmountForEntry: jest.fn().mockResolvedValue({
        wallet: toWalletSnapshot(buildWallet(9_000n)),
        transaction: buildHoldSnapshot("entry-1"),
        reused: false,
      }),
      refundEntryHoldByIdempotencyKey: jest.fn().mockResolvedValue({
        refunded: true,
      }),
    };

    const service = new EntriesService(
      prisma as any,
      buildRoundsService() as any,
      walletsService as any,
    );

    await expect(
      service.placeEntryForUser({
        roomId: "room-1",
        userId: user.id,
        amount: 1_000,
        idempotencyKey: "entry-key-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(walletsService.refundEntryHoldByIdempotencyKey).toHaveBeenCalledWith({
      holdIdempotencyKey: "entry-key-1",
      reason: "Round is no longer OPEN. Entry was not accepted.",
    });
  });

  it("rejects an idempotency key reused for a different entry request", async () => {
    const user = buildUser();
    const wallet = buildWallet();

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      room: {
        findUnique: jest.fn().mockResolvedValue(buildRoom()),
      },
      round: {
        findFirst: jest.fn().mockResolvedValue(buildRound()),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue({
          ...buildAppliedHoldTransaction("entry-1", "2000"),
        }),
      },
      $transaction: jest.fn(),
    };

    const service = new EntriesService(
      prisma as any,
      { toRoundSnapshot: jest.fn() } as any,
      { ensureMainWalletForUserId: jest.fn().mockResolvedValue(wallet) } as any,
    );

    await expect(
      service.placeEntryForUser({
        roomId: "room-1",
        userId: user.id,
        amount: 1_000,
        idempotencyKey: "entry-key-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
