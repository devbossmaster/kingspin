import { BadRequestException } from "@nestjs/common";
import {
  LedgerEntryDirection,
  LedgerTransactionType,
  Prisma,
  WalletAccountType,
} from "@kingspin/db";
import { WalletsService } from "./wallets.service";

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
    type: WalletAccountType.MAIN,
    balanceSnapshot,
    createdAt: now,
    updatedAt: now,
  };
}

type LedgerEntryFixture = {
  id: string;
  transactionId: string;
  walletAccountId: string;
  direction: LedgerEntryDirection;
  amount: bigint;
  balanceAfterSnapshot: bigint | null;
  createdAt: Date;
};

function buildEntry(
  id: string,
  overrides?: Partial<LedgerEntryFixture>,
): LedgerEntryFixture {
  return {
    id: `ledger-entry-${id}`,
    transactionId: `ledger-${id}`,
    walletAccountId: "wallet-1",
    direction: LedgerEntryDirection.DEBIT,
    amount: 1_000n,
    balanceAfterSnapshot: 9_000n,
    createdAt: now,
    ...overrides,
  };
}

function buildTransaction(
  id: string,
  overrides?: Partial<{
    type: LedgerTransactionType;
    referenceType: string | null;
    referenceId: string | null;
    idempotencyKey: string;
    metadata: Prisma.JsonValue | null;
    entries: LedgerEntryFixture[];
  }>,
) {
  return {
    id,
    type: overrides?.type ?? LedgerTransactionType.ENTRY_HOLD,
    referenceType: overrides?.referenceType ?? "ENTRY",
    referenceId: overrides?.referenceId ?? "entry-1",
    idempotencyKey: overrides?.idempotencyKey ?? "entry-key-1",
    metadata:
      overrides?.metadata ??
      ({
        userId: "user-1",
        roundId: "round-1",
        entryId: "entry-1",
        walletAccountId: "wallet-1",
        amount: "1000",
      } satisfies Prisma.JsonObject),
    createdAt: now,
    entries: overrides?.entries ?? [buildEntry(id)],
  };
}

function uniqueError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("WalletsService", () => {
  it("creates an idempotent entry hold in a short wallet transaction", async () => {
    const updatedWallet = buildWallet(9_000n);
    const holdTransaction = buildTransaction("hold-1", {
      metadata: {
        userId: "user-1",
        roundId: "round-1",
        entryId: "entry-1",
        walletAccountId: "wallet-1",
        amount: "1000",
        holdState: "HELD",
      },
    });

    const tx = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(holdTransaction),
      },
      walletAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updatedWallet),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const service = new WalletsService(prisma as any);

    const result = await service.holdEntryAmountForEntry({
      walletAccountId: "wallet-1",
      userId: "user-1",
      roundId: "round-1",
      entryId: "entry-1",
      amount: 1_000n,
      idempotencyKey: "entry-key-1",
    });

    expect(result.reused).toBe(false);
    expect(result.wallet.balanceSnapshot).toBe("9000");
    expect(tx.walletAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          balanceSnapshot: { gte: 1_000n },
        }),
        data: { balanceSnapshot: { decrement: 1_000n } },
      }),
    );
    expect(tx.ledgerTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: LedgerTransactionType.ENTRY_HOLD,
          idempotencyKey: "entry-key-1",
          metadata: expect.objectContaining({
            holdState: "HELD",
          }),
        }),
      }),
    );
  });

  it("reuses a matching entry hold without debiting again", async () => {
    const existingTransaction = buildTransaction("hold-1");
    const tx = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(existingTransaction),
      },
      walletAccount: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildWallet(9_000n)),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const service = new WalletsService(prisma as any);

    const result = await service.holdEntryAmountForEntry({
      walletAccountId: "wallet-1",
      userId: "user-1",
      roundId: "round-1",
      entryId: "entry-1",
      amount: 1_000n,
      idempotencyKey: "entry-key-1",
    });

    expect(result.reused).toBe(true);
    expect(tx.walletAccount.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an entry hold idempotency key with different metadata", async () => {
    const existingTransaction = buildTransaction("hold-1", {
      metadata: {
        userId: "user-1",
        roundId: "round-1",
        entryId: "entry-1",
        walletAccountId: "wallet-1",
        amount: "2000",
      },
    });
    const tx = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(existingTransaction),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const service = new WalletsService(prisma as any);

    await expect(
      service.holdEntryAmountForEntry({
        walletAccountId: "wallet-1",
        userId: "user-1",
        roundId: "round-1",
        entryId: "entry-1",
        amount: 1_000n,
        idempotencyKey: "entry-key-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates a targeted compensation refund for a held entry amount", async () => {
    const holdTransaction = buildTransaction("hold-1");
    const refundTransaction = buildTransaction("refund-1", {
      type: LedgerTransactionType.ENTRY_REFUND,
      idempotencyKey: "entry-hold-compensation:hold-1",
      metadata: {
        source: "ENTRY_HOLD_COMPENSATION",
        holdTransactionId: "hold-1",
        holdIdempotencyKey: "entry-key-1",
        amount: "1000",
        walletAccountId: "wallet-1",
      },
      entries: [
        buildEntry("refund-1", {
          direction: LedgerEntryDirection.CREDIT,
          amount: 1_000n,
          balanceAfterSnapshot: 10_000n,
        }),
      ],
    });

    const tx = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(holdTransaction),
        create: jest.fn().mockResolvedValue(refundTransaction),
      },
      walletAccount: {
        update: jest.fn().mockResolvedValue(buildWallet(10_000n)),
      },
    };
    const prisma = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(holdTransaction),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const service = new WalletsService(prisma as any);

    const result = await service.refundEntryHoldByIdempotencyKey({
      holdIdempotencyKey: "entry-key-1",
      reason: "ENTRY_WRITE_FAILED",
    });

    expect(result.refunded).toBe(true);
    expect(result.amount).toBe(1_000n);
    expect(tx.walletAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balanceSnapshot: { increment: 1_000n } },
      }),
    );
    expect(tx.ledgerTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: LedgerTransactionType.ENTRY_REFUND,
          idempotencyKey: "entry-hold-compensation:hold-1",
        }),
      }),
    );
  });

  it("does not refund an already compensated hold again during round cancellation", async () => {
    const compensatedHold = buildTransaction("hold-1");
    const liveHold = buildTransaction("hold-2", {
      idempotencyKey: "entry-key-2",
      entries: [buildEntry("hold-2", { amount: 2_000n })],
    });
    const compensation = buildTransaction("compensation-1", {
      type: LedgerTransactionType.ENTRY_REFUND,
      idempotencyKey: "entry-hold-compensation:hold-1",
      metadata: {
        source: "ENTRY_HOLD_COMPENSATION",
        holdTransactionId: "hold-1",
        holdIdempotencyKey: "entry-key-1",
      },
      entries: [],
    });

    const tx = {
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([compensatedHold, liveHold])
          .mockResolvedValueOnce([compensation]),
        create: jest.fn().mockResolvedValue({ id: "refund-1" }),
      },
      walletAccount: {
        update: jest.fn().mockResolvedValue(buildWallet(12_000n)),
      },
    };

    const service = new WalletsService({} as any);

    const result = await service.refundEntryHolds(tx as any, {
      entryId: "entry-1",
      roundId: "round-1",
    });

    expect(result.refunded).toBe(true);
    expect(result.amount).toBe(2_000n);
    expect(tx.walletAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balanceSnapshot: { increment: 2_000n } },
      }),
    );
  });

  it("reuses a matching round payout without crediting twice", async () => {
    const wallet = buildWallet(20_000n);
    const payoutTransaction = buildTransaction("payout-1", {
      type: LedgerTransactionType.ROUND_PAYOUT,
      referenceType: "ROUND",
      referenceId: "round-1",
      idempotencyKey: "round-win:round-1:entry-1",
      metadata: {
        userId: "user-1",
        roundId: "round-1",
        winnerEntryId: "entry-1",
        amount: "5000",
        walletAccountId: "wallet-1",
      },
      entries: [
        buildEntry("payout-1", {
          direction: LedgerEntryDirection.CREDIT,
          amount: 5_000n,
          balanceAfterSnapshot: 20_000n,
        }),
      ],
    });

    const prisma = {
      walletAccount: {
        upsert: jest.fn().mockResolvedValue(wallet),
        findUniqueOrThrow: jest.fn().mockResolvedValue(wallet),
      },
      ledgerTransaction: {
        findUnique: jest.fn().mockResolvedValue(payoutTransaction),
      },
      $transaction: jest.fn(),
    };

    const service = new WalletsService(prisma as any);

    const result = await service.creditRoundWin({
      userId: "user-1",
      roundId: "round-1",
      winnerEntryId: "entry-1",
      amount: 5_000n,
    });

    expect(result.reused).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reuses a matching admin credit idempotency key after a unique race", async () => {
    const user = buildUser();
    const wallet = buildWallet(15_000n);
    const adminCredit = buildTransaction("admin-credit-1", {
      type: LedgerTransactionType.ADMIN_CREDIT,
      referenceType: "ADMIN_DEV_CREDIT",
      referenceId: "user-1",
      idempotencyKey: "admin-credit-key-1",
      metadata: {
        reason: "test",
        amount: "5000",
        userId: "user-1",
        walletAccountId: "wallet-1",
      },
      entries: [
        buildEntry("admin-credit-1", {
          direction: LedgerEntryDirection.CREDIT,
          amount: 5_000n,
          balanceAfterSnapshot: 15_000n,
        }),
      ],
    });

    const prisma = {
      user: {
        upsert: jest.fn().mockResolvedValue(user),
      },
      walletAccount: {
        upsert: jest.fn().mockResolvedValue(buildWallet(10_000n)),
        findUniqueOrThrow: jest.fn().mockResolvedValue(wallet),
      },
      ledgerTransaction: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(adminCredit),
      },
      $transaction: jest.fn().mockRejectedValue(uniqueError()),
    };

    const service = new WalletsService(prisma as any);

    const result = await service.devCreditMainWallet({
      playerKey: "player-1",
      amount: 5_000,
      reason: "test",
      idempotencyKey: "admin-credit-key-1",
    });

    expect(result.reused).toBe(true);
    expect(result.wallet.balanceSnapshot).toBe("15000");
  });
});
