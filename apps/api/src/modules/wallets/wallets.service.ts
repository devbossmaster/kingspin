import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LedgerEntryDirection,
  LedgerTransactionType,
  Prisma,
  WalletAccountType,
  type LedgerEntry,
  type LedgerTransaction,
  type User,
  type WalletAccount,
} from "@kingspin/db";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

export type DevWalletBody = {
  userId?: unknown;
  playerKey?: unknown;
  amount?: unknown;
  reason?: unknown;
  idempotencyKey?: unknown;
};

export type WalletSnapshot = {
  id: string;
  userId: string | null;
  type: WalletAccountType;
  balanceSnapshot: string;
  createdAt: string;
  updatedAt: string;
};

export type EntryRefundResult = {
  entryId: string;
  refunded: boolean;
  amount: bigint;
  reason: "REFUNDED" | "NO_HOLD_FOUND" | "ALREADY_REFUNDED";
};

type LedgerTransactionWithEntries = LedgerTransaction & {
  entries: LedgerEntry[];
};

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async devCreditMainWallet(body: DevWalletBody) {
    const amount = this.parsePositiveAmount(body?.amount);

    const user = await this.resolveDevUserOutsideTransaction(body);
    const wallet = await this.ensureMainWalletForUserId(user.id);

    const customIdempotencyKey =
      typeof body?.idempotencyKey === "string" &&
      body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim()
        : null;

    const idempotencyKey =
      customIdempotencyKey ?? `admin-credit:${wallet.id}:${randomUUID()}`;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedWallet = await tx.walletAccount.update({
          where: { id: wallet.id },
          data: {
            balanceSnapshot: {
              increment: amount,
            },
          },
        });

        const reason =
          typeof body?.reason === "string" && body.reason.trim().length > 0
            ? body.reason.trim()
            : "Dev admin credit";

        const transaction = await tx.ledgerTransaction.create({
          data: {
            type: LedgerTransactionType.ADMIN_CREDIT,
            referenceType: "ADMIN_DEV_CREDIT",
            referenceId: user.id,
            idempotencyKey,
            metadata: {
              reason,
              amount: amount.toString(),
              userId: user.id,
              walletAccountId: updatedWallet.id,
            },
            entries: {
              create: {
                walletAccountId: updatedWallet.id,
                direction: LedgerEntryDirection.CREDIT,
                amount,
                balanceAfterSnapshot: updatedWallet.balanceSnapshot,
              },
            },
          },
          include: { entries: true },
        });

        return {
          wallet: updatedWallet,
          transaction,
          reused: false,
        };
      });

      return {
        player: this.toPlayerSnapshot(user),
        wallet: this.toWalletSnapshot(result.wallet),
        transaction: this.toLedgerTransactionSnapshot(result.transaction),
        reused: result.reused,
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const existingTransaction =
          await this.prisma.ledgerTransaction.findUniqueOrThrow({
            where: { idempotencyKey },
            include: { entries: true },
          });

        const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
          where: { id: wallet.id },
        });

        return {
          player: this.toPlayerSnapshot(user),
          wallet: this.toWalletSnapshot(freshWallet),
          transaction: this.toLedgerTransactionSnapshot(existingTransaction),
          reused: true,
        };
      }

      throw error;
    }
  }

  async getMainWalletByUserId(userId: string) {
    if (!userId) {
      throw new BadRequestException("userId is required.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const wallet = await this.ensureMainWalletForUserId(user.id);

    return {
      player: this.toPlayerSnapshot(user),
      wallet: this.toWalletSnapshot(wallet),
    };
  }

  async getDevMainWalletBalance(query: DevWalletBody) {
    const user = await this.resolveDevUserOutsideTransaction(query);
    const wallet = await this.ensureMainWalletForUserId(user.id);

    return {
      player: this.toPlayerSnapshot(user),
      wallet: this.toWalletSnapshot(wallet),
    };
  }

  async holdEntryAmount(
    tx: Prisma.TransactionClient,
    args: {
      walletAccountId: string;
      userId: string;
      roundId: string;
      entryId: string;
      amount: bigint;
      idempotencyKey: string;
    },
  ): Promise<WalletSnapshot> {
    const existingTransaction = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });

    if (existingTransaction) {
      const wallet = await tx.walletAccount.findUniqueOrThrow({
        where: { id: args.walletAccountId },
      });

      return this.toWalletSnapshot(wallet);
    }

    const debitResult = await tx.walletAccount.updateMany({
      where: {
        id: args.walletAccountId,
        userId: args.userId,
        type: WalletAccountType.MAIN,
        balanceSnapshot: {
          gte: args.amount,
        },
      },
      data: {
        balanceSnapshot: {
          decrement: args.amount,
        },
      },
    });

    if (debitResult.count !== 1) {
      const wallet = await tx.walletAccount.findUnique({
        where: { id: args.walletAccountId },
      });

      const balance = wallet?.balanceSnapshot.toString() ?? "0";

      throw new BadRequestException(
        `Insufficient MAIN wallet balance. Balance is ${balance}, required is ${args.amount.toString()}.`,
      );
    }

    const updatedWallet = await tx.walletAccount.findUniqueOrThrow({
      where: { id: args.walletAccountId },
    });

    await tx.ledgerTransaction.create({
      data: {
        type: LedgerTransactionType.ENTRY_HOLD,
        referenceType: "ENTRY",
        referenceId: args.entryId,
        idempotencyKey: args.idempotencyKey,
        metadata: {
          userId: args.userId,
          roundId: args.roundId,
          entryId: args.entryId,
          amount: args.amount.toString(),
          walletAccountId: updatedWallet.id,
        },
        entries: {
          create: {
            walletAccountId: updatedWallet.id,
            direction: LedgerEntryDirection.DEBIT,
            amount: args.amount,
            balanceAfterSnapshot: updatedWallet.balanceSnapshot,
          },
        },
      },
    });

    return this.toWalletSnapshot(updatedWallet);
  }

  async refundEntryHolds(
    tx: Prisma.TransactionClient,
    args: {
      entryId: string;
      roundId: string;
    },
  ): Promise<EntryRefundResult> {
    const refundIdempotencyKey = `entry-refund:${args.entryId}`;

    const existingRefund = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: refundIdempotencyKey },
      include: { entries: true },
    });

    if (existingRefund) {
      const refundedAmount = existingRefund.entries.reduce(
        (sum, entry) => sum + entry.amount,
        0n,
      );

      return {
        entryId: args.entryId,
        refunded: false,
        amount: refundedAmount,
        reason: "ALREADY_REFUNDED",
      };
    }

    const holdTransactions = await tx.ledgerTransaction.findMany({
      where: {
        type: LedgerTransactionType.ENTRY_HOLD,
        referenceType: "ENTRY",
        referenceId: args.entryId,
      },
      include: {
        entries: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const debitEntries = holdTransactions.flatMap((transaction) =>
      transaction.entries.filter(
        (entry) => entry.direction === LedgerEntryDirection.DEBIT,
      ),
    );

    if (debitEntries.length === 0) {
      return {
        entryId: args.entryId,
        refunded: false,
        amount: 0n,
        reason: "NO_HOLD_FOUND",
      };
    }

    const walletAccountId = debitEntries[0].walletAccountId;
    const mixedWallet = debitEntries.some(
      (entry) => entry.walletAccountId !== walletAccountId,
    );

    if (mixedWallet) {
      throw new BadRequestException(
        `Entry ${args.entryId} has holds from multiple wallets. Manual review required.`,
      );
    }

    const refundAmount = debitEntries.reduce(
      (sum, entry) => sum + entry.amount,
      0n,
    );

    const updatedWallet = await tx.walletAccount.update({
      where: { id: walletAccountId },
      data: {
        balanceSnapshot: {
          increment: refundAmount,
        },
      },
    });

    await tx.ledgerTransaction.create({
      data: {
        type: LedgerTransactionType.ENTRY_REFUND,
        referenceType: "ENTRY",
        referenceId: args.entryId,
        idempotencyKey: refundIdempotencyKey,
        metadata: {
          roundId: args.roundId,
          entryId: args.entryId,
          amount: refundAmount.toString(),
          walletAccountId: updatedWallet.id,
          source: "ENTRY_HOLD_LEDGER_REVERSAL",
        },
        entries: {
          create: {
            walletAccountId: updatedWallet.id,
            direction: LedgerEntryDirection.CREDIT,
            amount: refundAmount,
            balanceAfterSnapshot: updatedWallet.balanceSnapshot,
          },
        },
      },
    });

    return {
      entryId: args.entryId,
      refunded: true,
      amount: refundAmount,
      reason: "REFUNDED",
    };
  }

  async refundEntryHoldsByEntryId(args: {
    entryId: string;
    roundId: string;
  }): Promise<EntryRefundResult> {
    return this.prisma.$transaction((tx) =>
      this.refundEntryHolds(tx, args),
    );
  }

  async creditRoundWin(args: {
    userId: string;
    roundId: string;
    winnerEntryId: string;
    amount: bigint;
  }) {
    if (args.amount <= 0n) {
      throw new BadRequestException("Round win amount must be greater than zero.");
    }

    const wallet = await this.ensureMainWalletForUserId(args.userId);
    const idempotencyKey = `round-win:${args.roundId}:${args.winnerEntryId}`;

    const existingTransaction = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });

    if (existingTransaction) {
      const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      return {
        wallet: this.toWalletSnapshot(freshWallet),
        transaction: this.toLedgerTransactionSnapshot(existingTransaction),
        reused: true,
      };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedWallet = await tx.walletAccount.update({
          where: { id: wallet.id },
          data: {
            balanceSnapshot: {
              increment: args.amount,
            },
          },
        });

        const transaction = await tx.ledgerTransaction.create({
          data: {
            type: LedgerTransactionType.ROUND_PAYOUT,
            referenceType: "ROUND",
            referenceId: args.roundId,
            idempotencyKey,
            metadata: {
              userId: args.userId,
              roundId: args.roundId,
              winnerEntryId: args.winnerEntryId,
              amount: args.amount.toString(),
              walletAccountId: updatedWallet.id,
            },
            entries: {
              create: {
                walletAccountId: updatedWallet.id,
                direction: LedgerEntryDirection.CREDIT,
                amount: args.amount,
                balanceAfterSnapshot: updatedWallet.balanceSnapshot,
              },
            },
          },
          include: { entries: true },
        });

        return {
          wallet: updatedWallet,
          transaction,
          reused: false,
        };
      });

      return {
        wallet: this.toWalletSnapshot(result.wallet),
        transaction: this.toLedgerTransactionSnapshot(result.transaction),
        reused: result.reused,
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const transaction =
          await this.prisma.ledgerTransaction.findUniqueOrThrow({
            where: { idempotencyKey },
            include: { entries: true },
          });

        const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
          where: { id: wallet.id },
        });

        return {
          wallet: this.toWalletSnapshot(freshWallet),
          transaction: this.toLedgerTransactionSnapshot(transaction),
          reused: true,
        };
      }

      throw error;
    }
  }
  async ensureMainWalletForUserId(userId: string): Promise<WalletAccount> {
    return this.prisma.walletAccount.upsert({
      where: {
        userId_type: {
          userId,
          type: WalletAccountType.MAIN,
        },
      },
      update: {},
      create: {
        userId,
        type: WalletAccountType.MAIN,
      },
    });
  }

  private async resolveDevUserOutsideTransaction(
    body: DevWalletBody,
  ): Promise<User> {
    if (typeof body?.userId === "string" && body.userId.trim().length > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: body.userId.trim() },
      });

      if (!user) {
        throw new NotFoundException("User not found.");
      }

      return user;
    }

    const playerKey =
      typeof body?.playerKey === "string" && body.playerKey.trim().length > 0
        ? body.playerKey.trim()
        : "player-1";

    const safePlayerKey = playerKey
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .slice(0, 32);

    const email = `dev+${safePlayerKey}@kingspin.local`;
    const username = `dev_${safePlayerKey}`;

    return this.prisma.user.upsert({
      where: { email },
      update: {
        username,
        fullName: `Dev Player ${safePlayerKey}`,
        emailVerified: true,
      },
      create: {
        email,
        username,
        fullName: `Dev Player ${safePlayerKey}`,
        emailVerified: true,
      },
    });
  }

  private parsePositiveAmount(rawAmount: unknown): bigint {
    if (typeof rawAmount !== "number") {
      throw new BadRequestException("amount must be a number.");
    }

    if (!Number.isSafeInteger(rawAmount)) {
      throw new BadRequestException("amount must be a safe integer.");
    }

    if (rawAmount <= 0) {
      throw new BadRequestException("amount must be greater than zero.");
    }

    return BigInt(rawAmount);
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }

  private toPlayerSnapshot(user: User) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
    };
  }

  private toWalletSnapshot(wallet: WalletAccount): WalletSnapshot {
    return {
      id: wallet.id,
      userId: wallet.userId,
      type: wallet.type,
      balanceSnapshot: wallet.balanceSnapshot.toString(),
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  private toLedgerTransactionSnapshot(transaction: LedgerTransactionWithEntries) {
    return {
      id: transaction.id,
      type: transaction.type,
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
      idempotencyKey: transaction.idempotencyKey,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt.toISOString(),
      entries: transaction.entries.map((entry) => ({
        id: entry.id,
        walletAccountId: entry.walletAccountId,
        direction: entry.direction,
        amount: entry.amount.toString(),
        balanceAfterSnapshot:
          entry.balanceAfterSnapshot?.toString() ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}



