import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryDirection,
  LedgerTransactionType,
  Prisma,
  WalletAccountType,
  type LedgerEntry,
  type LedgerTransaction,
  type User,
  type WalletAccount,
} from '@kingspin/db';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

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

export type LedgerTransactionSnapshot = {
  id: string;
  type: LedgerTransactionType;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
  entries: {
    id: string;
    walletAccountId: string;
    direction: LedgerEntryDirection;
    amount: string;
    balanceAfterSnapshot: string | null;
    createdAt: string;
  }[];
};

export type EntryHoldResult = {
  wallet: WalletSnapshot;
  transaction: LedgerTransactionSnapshot;
  reused: boolean;
};

export type EntryRefundResult = {
  entryId: string;
  refunded: boolean;
  amount: bigint;
  reason: 'REFUNDED' | 'NO_HOLD_FOUND' | 'ALREADY_REFUNDED';
};

export type EntryHoldCompensationResult = {
  holdIdempotencyKey: string;
  refunded: boolean;
  amount: bigint;
  reason: 'REFUNDED' | 'NO_HOLD_FOUND' | 'ALREADY_REFUNDED';
  wallet: WalletSnapshot | null;
  transaction: LedgerTransactionSnapshot | null;
};

export type MoneyMutationResult = {
  wallet: WalletSnapshot;
  transaction: LedgerTransactionSnapshot;
  reused: boolean;
};

type LedgerTransactionWithEntries = LedgerTransaction & {
  entries: LedgerEntry[];
};

type EntryHoldArgs = {
  walletAccountId: string;
  userId: string;
  roundId: string;
  entryId: string;
  amount: bigint;
  idempotencyKey: string;
  timingTraceId?: string;
};

const WALLET_HOLD_TIMING_WARN_THRESHOLD_MS = 1_500;

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private readonly transactionOptions = {
    maxWait: 5_000,
    timeout: 10_000,
  } as const;

  static entryHoldCompensationIdempotencyKey(holdTransactionId: string) {
    return `entry-hold-compensation:${holdTransactionId}`;
  }

  async devCreditMainWallet(body: DevWalletBody) {
    const amount = this.parsePositiveAmount(body?.amount);

    const user = await this.resolveDevUserOutsideTransaction(body);
    const wallet = await this.ensureMainWalletForUserId(user.id);

    const customIdempotencyKey =
      typeof body?.idempotencyKey === 'string' &&
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
          typeof body?.reason === 'string' && body.reason.trim().length > 0
            ? body.reason.trim()
            : 'Dev admin credit';

        const transaction = await tx.ledgerTransaction.create({
          data: {
            type: LedgerTransactionType.ADMIN_CREDIT,
            referenceType: 'ADMIN_DEV_CREDIT',
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

        this.assertAdminCreditTransactionMatches(existingTransaction, {
          userId: user.id,
          walletAccountId: wallet.id,
          amount,
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
      throw new BadRequestException('userId is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
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
    args: EntryHoldArgs,
  ): Promise<WalletSnapshot> {
    const result = await this.holdEntryAmountForEntryInTransaction(tx, args);

    return result.wallet;
  }

  async holdEntryAmountForEntryInTransaction(
    tx: Prisma.TransactionClient,
    args: EntryHoldArgs,
  ): Promise<EntryHoldResult> {
    return this.holdEntryAmountInTransaction(tx, args);
  }

  async holdEntryAmountForEntry(args: EntryHoldArgs): Promise<EntryHoldResult> {
    try {
      return await this.prisma.$transaction(
        (tx) => this.holdEntryAmountInTransaction(tx, args),
        this.transactionOptions,
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const existingTransaction =
          await this.prisma.ledgerTransaction.findUniqueOrThrow({
            where: { idempotencyKey: args.idempotencyKey },
            include: { entries: true },
          });

        this.assertEntryHoldTransactionMatches(existingTransaction, args);

        const wallet = await this.prisma.walletAccount.findUniqueOrThrow({
          where: { id: args.walletAccountId },
        });

        return {
          wallet: this.toWalletSnapshot(wallet),
          transaction: this.toLedgerTransactionSnapshot(existingTransaction),
          reused: true,
        };
      }

      throw error;
    }
  }

  private async holdEntryAmountInTransaction(
    tx: Prisma.TransactionClient,
    args: EntryHoldArgs,
  ): Promise<EntryHoldResult> {
    const traceId =
      args.timingTraceId ??
      `${args.roundId}:${args.userId}:${Date.now().toString(36)}`;
    const startedAt = Date.now();
    let previousAt = startedAt;
    let timingFlushed = false;
    const timingEvents: string[] = [];

    const flushTimingIfSlow = () => {
      const totalMs = Date.now() - startedAt;

      if (timingFlushed || totalMs < WALLET_HOLD_TIMING_WARN_THRESHOLD_MS) {
        return;
      }

      timingFlushed = true;

      this.logger.warn(
        `[wallet-hold-timing:${traceId}] slow wallet hold total=${totalMs}ms events=${timingEvents.join(
          '; ',
        )}`,
      );
    };

    const mark = (label: string) => {
      const now = Date.now();
      const stepMs = now - previousAt;
      const totalMs = now - startedAt;
      previousAt = now;

      timingEvents.push(`${label} step=${stepMs}ms total=${totalMs}ms`);
    };

    const existingTransaction = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
      include: { entries: true },
    });

    mark('existing ledger lookup');

    if (existingTransaction) {
      this.assertEntryHoldTransactionMatches(existingTransaction, args);

      const wallet = await tx.walletAccount.findUniqueOrThrow({
        where: { id: args.walletAccountId },
      });

      mark('reused wallet read');
      flushTimingIfSlow();

      return {
        wallet: this.toWalletSnapshot(wallet),
        transaction: this.toLedgerTransactionSnapshot(existingTransaction),
        reused: true,
      };
    }

    const updatedWallets = await tx.walletAccount.updateManyAndReturn({
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
    const updatedWallet = updatedWallets[0];

    mark('wallet debit updateManyAndReturn');

    if (!updatedWallet) {
      const wallet = await tx.walletAccount.findUnique({
        where: { id: args.walletAccountId },
      });

      mark('wallet read after failed debit');

      const balance = wallet?.balanceSnapshot.toString() ?? '0';
      flushTimingIfSlow();

      throw new BadRequestException(
        `Insufficient MAIN wallet balance. Balance is ${balance}, required is ${args.amount.toString()}.`,
      );
    }

    const transaction = await tx.ledgerTransaction.create({
      data: {
        type: LedgerTransactionType.ENTRY_HOLD,
        referenceType: 'ENTRY',
        referenceId: args.entryId,
        idempotencyKey: args.idempotencyKey,
        metadata: {
          userId: args.userId,
          roundId: args.roundId,
          entryId: args.entryId,
          amount: args.amount.toString(),
          walletAccountId: updatedWallet.id,
          holdState: 'HELD',
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
      include: { entries: true },
    });

    mark('ledger transaction create');
    flushTimingIfSlow();

    return {
      wallet: this.toWalletSnapshot(updatedWallet),
      transaction: this.toLedgerTransactionSnapshot(transaction),
      reused: false,
    };
  }

  async refundEntryHoldByIdempotencyKey(args: {
    holdIdempotencyKey: string;
    reason: string;
  }): Promise<EntryHoldCompensationResult> {
    const holdTransaction = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: args.holdIdempotencyKey },
      include: { entries: true },
    });

    if (!holdTransaction) {
      return {
        holdIdempotencyKey: args.holdIdempotencyKey,
        refunded: false,
        amount: 0n,
        reason: 'NO_HOLD_FOUND',
        wallet: null,
        transaction: null,
      };
    }

    this.assertEntryHoldLedgerShape(holdTransaction);

    const refundIdempotencyKey =
      WalletsService.entryHoldCompensationIdempotencyKey(holdTransaction.id);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingRefund = await tx.ledgerTransaction.findUnique({
          where: { idempotencyKey: refundIdempotencyKey },
          include: { entries: true },
        });

        if (existingRefund) {
          this.assertEntryHoldCompensationTransactionMatches(existingRefund, {
            holdTransactionId: holdTransaction.id,
            holdIdempotencyKey: args.holdIdempotencyKey,
          });

          const walletAccountId =
            existingRefund.entries[0]?.walletAccountId ??
            holdTransaction.entries[0]?.walletAccountId;

          const wallet = walletAccountId
            ? await tx.walletAccount.findUnique({
                where: { id: walletAccountId },
              })
            : null;

          return {
            holdIdempotencyKey: args.holdIdempotencyKey,
            refunded: false,
            amount: this.sumEntries(existingRefund.entries),
            reason: 'ALREADY_REFUNDED' as const,
            wallet: wallet ? this.toWalletSnapshot(wallet) : null,
            transaction: this.toLedgerTransactionSnapshot(existingRefund),
          };
        }

        const freshHoldTransaction =
          await tx.ledgerTransaction.findUniqueOrThrow({
            where: { id: holdTransaction.id },
            include: { entries: true },
          });

        this.assertEntryHoldLedgerShape(freshHoldTransaction);

        const debitEntries = freshHoldTransaction.entries.filter(
          (entry) => entry.direction === LedgerEntryDirection.DEBIT,
        );
        const walletAccountId = debitEntries[0].walletAccountId;
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

        const refundTransaction = await tx.ledgerTransaction.create({
          data: {
            type: LedgerTransactionType.ENTRY_REFUND,
            referenceType: 'ENTRY',
            referenceId: freshHoldTransaction.referenceId,
            idempotencyKey: refundIdempotencyKey,
            metadata: {
              source: 'ENTRY_HOLD_COMPENSATION',
              holdTransactionId: freshHoldTransaction.id,
              holdIdempotencyKey: args.holdIdempotencyKey,
              roundId: this.getMetadataString(
                freshHoldTransaction.metadata,
                'roundId',
              ),
              entryId: this.getMetadataString(
                freshHoldTransaction.metadata,
                'entryId',
              ),
              amount: refundAmount.toString(),
              walletAccountId: updatedWallet.id,
              reason: args.reason,
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
          include: { entries: true },
        });

        return {
          holdIdempotencyKey: args.holdIdempotencyKey,
          refunded: true,
          amount: refundAmount,
          reason: 'REFUNDED' as const,
          wallet: this.toWalletSnapshot(updatedWallet),
          transaction: this.toLedgerTransactionSnapshot(refundTransaction),
        };
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const existingRefund =
          await this.prisma.ledgerTransaction.findUniqueOrThrow({
            where: { idempotencyKey: refundIdempotencyKey },
            include: { entries: true },
          });

        this.assertEntryHoldCompensationTransactionMatches(existingRefund, {
          holdTransactionId: holdTransaction.id,
          holdIdempotencyKey: args.holdIdempotencyKey,
        });

        const walletAccountId =
          existingRefund.entries[0]?.walletAccountId ??
          holdTransaction.entries[0]?.walletAccountId;
        const wallet = walletAccountId
          ? await this.prisma.walletAccount.findUnique({
              where: { id: walletAccountId },
            })
          : null;

        return {
          holdIdempotencyKey: args.holdIdempotencyKey,
          refunded: false,
          amount: this.sumEntries(existingRefund.entries),
          reason: 'ALREADY_REFUNDED',
          wallet: wallet ? this.toWalletSnapshot(wallet) : null,
          transaction: this.toLedgerTransactionSnapshot(existingRefund),
        };
      }

      throw error;
    }
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
        reason: 'ALREADY_REFUNDED',
      };
    }

    const holdTransactions = await tx.ledgerTransaction.findMany({
      where: {
        type: LedgerTransactionType.ENTRY_HOLD,
        referenceType: 'ENTRY',
        referenceId: args.entryId,
      },
      include: {
        entries: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const compensationKeys = holdTransactions.map((transaction) =>
      WalletsService.entryHoldCompensationIdempotencyKey(transaction.id),
    );
    const compensationTransactions = compensationKeys.length
      ? await tx.ledgerTransaction.findMany({
          where: {
            idempotencyKey: {
              in: compensationKeys,
            },
          },
        })
      : [];
    const compensatedHoldIds = new Set(
      compensationTransactions
        .map((transaction) =>
          this.getMetadataString(transaction.metadata, 'holdTransactionId'),
        )
        .filter((value): value is string => typeof value === 'string'),
    );

    const refundableHoldTransactions = holdTransactions.filter(
      (transaction) => !compensatedHoldIds.has(transaction.id),
    );

    const debitEntries = refundableHoldTransactions.flatMap((transaction) =>
      transaction.entries.filter(
        (entry) => entry.direction === LedgerEntryDirection.DEBIT,
      ),
    );

    if (debitEntries.length === 0) {
      return {
        entryId: args.entryId,
        refunded: false,
        amount: 0n,
        reason: 'NO_HOLD_FOUND',
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
        referenceType: 'ENTRY',
        referenceId: args.entryId,
        idempotencyKey: refundIdempotencyKey,
        metadata: {
          roundId: args.roundId,
          entryId: args.entryId,
          amount: refundAmount.toString(),
          walletAccountId: updatedWallet.id,
          source: 'ENTRY_HOLD_LEDGER_REVERSAL',
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
      reason: 'REFUNDED',
    };
  }

  async refundEntryHoldsByEntryId(args: {
    entryId: string;
    roundId: string;
  }): Promise<EntryRefundResult> {
    return this.prisma.$transaction(
      (tx) => this.refundEntryHolds(tx, args),
      this.transactionOptions,
    );
  }

  async creditRoundWin(args: {
    userId: string;
    roundId: string;
    winnerEntryId: string;
    amount: bigint;
  }) {
    if (args.amount <= 0n) {
      throw new BadRequestException(
        'Round win amount must be greater than zero.',
      );
    }

    const wallet = await this.ensureMainWalletForUserId(args.userId);
    const idempotencyKey = `round-win:${args.roundId}:${args.winnerEntryId}`;

    const existingTransaction = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });

    if (existingTransaction) {
      this.assertRoundPayoutTransactionMatches(existingTransaction, args);

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
            referenceType: 'ROUND',
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

        this.assertRoundPayoutTransactionMatches(transaction, args);

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

  async creditDepositInTransaction(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      depositId: string;
      amount: bigint;
      currency: string;
      provider: string;
      idempotencyKey?: string;
    },
  ): Promise<MoneyMutationResult> {
    const idempotencyKey =
      args.idempotencyKey ?? `deposit-credit:${args.depositId}`;

    const existingTransaction = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });

    if (existingTransaction) {
      this.assertDepositCreditTransactionMatches(existingTransaction, args);

      const walletAccountId = existingTransaction.entries[0]?.walletAccountId;
      const wallet = await tx.walletAccount.findUniqueOrThrow({
        where: { id: walletAccountId },
      });

      return {
        wallet: this.toWalletSnapshot(wallet),
        transaction: this.toLedgerTransactionSnapshot(existingTransaction),
        reused: true,
      };
    }

    const wallet = await this.ensureMainWalletForUserIdInTransaction(
      tx,
      args.userId,
    );
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
        type: LedgerTransactionType.DEPOSIT,
        referenceType: 'DEPOSIT',
        referenceId: args.depositId,
        idempotencyKey,
        metadata: {
          userId: args.userId,
          depositId: args.depositId,
          amount: args.amount.toString(),
          currency: args.currency,
          provider: args.provider,
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
      wallet: this.toWalletSnapshot(updatedWallet),
      transaction: this.toLedgerTransactionSnapshot(transaction),
      reused: false,
    };
  }

  async reserveWithdrawalInTransaction(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      withdrawalId: string;
      walletAccountId: string;
      amount: bigint;
      currency: string;
      provider: string;
      idempotencyKey?: string;
    },
  ): Promise<MoneyMutationResult> {
    const idempotencyKey =
      args.idempotencyKey ?? `withdrawal-reserve:${args.withdrawalId}`;

    const existingTransaction = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });

    if (existingTransaction) {
      this.assertWithdrawalReserveTransactionMatches(existingTransaction, args);

      const wallet = await tx.walletAccount.findUniqueOrThrow({
        where: { id: args.walletAccountId },
      });

      return {
        wallet: this.toWalletSnapshot(wallet),
        transaction: this.toLedgerTransactionSnapshot(existingTransaction),
        reused: true,
      };
    }

    const updatedWallets = await tx.walletAccount.updateManyAndReturn({
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
    const updatedWallet = updatedWallets[0];

    if (!updatedWallet) {
      const wallet = await tx.walletAccount.findUnique({
        where: { id: args.walletAccountId },
      });
      const balance = wallet?.balanceSnapshot.toString() ?? '0';

      throw new BadRequestException(
        `Insufficient MAIN wallet balance. Balance is ${balance}, required is ${args.amount.toString()}.`,
      );
    }

    const transaction = await tx.ledgerTransaction.create({
      data: {
        type: LedgerTransactionType.WITHDRAWAL_REQUEST,
        referenceType: 'WITHDRAWAL',
        referenceId: args.withdrawalId,
        idempotencyKey,
        metadata: {
          userId: args.userId,
          withdrawalId: args.withdrawalId,
          amount: args.amount.toString(),
          currency: args.currency,
          provider: args.provider,
          walletAccountId: updatedWallet.id,
          reserveState: 'RESERVED',
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
      include: { entries: true },
    });

    return {
      wallet: this.toWalletSnapshot(updatedWallet),
      transaction: this.toLedgerTransactionSnapshot(transaction),
      reused: false,
    };
  }

  async refundWithdrawalInTransaction(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      withdrawalId: string;
      walletAccountId: string;
      amount: bigint;
      currency: string;
      provider: string;
      reason: string;
      idempotencyKey?: string;
    },
  ): Promise<MoneyMutationResult> {
    const idempotencyKey =
      args.idempotencyKey ?? `withdrawal-refund:${args.withdrawalId}`;

    const existingTransaction = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });

    if (existingTransaction) {
      this.assertWithdrawalRefundTransactionMatches(existingTransaction, args);

      const wallet = await tx.walletAccount.findUniqueOrThrow({
        where: { id: args.walletAccountId },
      });

      return {
        wallet: this.toWalletSnapshot(wallet),
        transaction: this.toLedgerTransactionSnapshot(existingTransaction),
        reused: true,
      };
    }

    const updatedWallet = await tx.walletAccount.update({
      where: { id: args.walletAccountId },
      data: {
        balanceSnapshot: {
          increment: args.amount,
        },
      },
    });

    const transaction = await tx.ledgerTransaction.create({
      data: {
        type: LedgerTransactionType.WITHDRAWAL_REFUND,
        referenceType: 'WITHDRAWAL',
        referenceId: args.withdrawalId,
        idempotencyKey,
        metadata: {
          userId: args.userId,
          withdrawalId: args.withdrawalId,
          amount: args.amount.toString(),
          currency: args.currency,
          provider: args.provider,
          walletAccountId: updatedWallet.id,
          reason: args.reason,
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
      wallet: this.toWalletSnapshot(updatedWallet),
      transaction: this.toLedgerTransactionSnapshot(transaction),
      reused: false,
    };
  }

  async ensureMainWalletForUserId(userId: string): Promise<WalletAccount> {
    if (!userId) {
      throw new BadRequestException('userId is required.');
    }

    const existingWallet = await this.prisma.walletAccount.findUnique({
      where: {
        userId_type: {
          userId,
          type: WalletAccountType.MAIN,
        },
      },
    });

    if (existingWallet) {
      return existingWallet;
    }

    try {
      return await this.prisma.walletAccount.create({
        data: {
          userId,
          type: WalletAccountType.MAIN,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return this.prisma.walletAccount.findUniqueOrThrow({
          where: {
            userId_type: {
              userId,
              type: WalletAccountType.MAIN,
            },
          },
        });
      }

      throw error;
    }
  }

  private async ensureMainWalletForUserIdInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<WalletAccount> {
    return tx.walletAccount.upsert({
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
    if (typeof body?.userId === 'string' && body.userId.trim().length > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: body.userId.trim() },
      });

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      return user;
    }

    const playerKey =
      typeof body?.playerKey === 'string' && body.playerKey.trim().length > 0
        ? body.playerKey.trim()
        : 'player-1';

    const safePlayerKey = playerKey
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
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
    if (typeof rawAmount !== 'number') {
      throw new BadRequestException('amount must be a number.');
    }

    if (!Number.isSafeInteger(rawAmount)) {
      throw new BadRequestException('amount must be a safe integer.');
    }

    if (rawAmount <= 0) {
      throw new BadRequestException('amount must be greater than zero.');
    }

    return BigInt(rawAmount);
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
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

  private assertAdminCreditTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      userId: string;
      walletAccountId: string;
      amount: bigint;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.ADMIN_CREDIT &&
      transaction.referenceType === 'ADMIN_DEV_CREDIT' &&
      transaction.referenceId === args.userId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'walletAccountId') ===
        args.walletAccountId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString();

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different admin credit.',
      );
    }
  }

  private assertEntryHoldTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      walletAccountId: string;
      userId: string;
      roundId: string;
      amount: bigint;
    },
  ) {
    const transactionEntryId =
      this.getMetadataString(transaction.metadata, 'entryId') ??
      transaction.referenceId;

    const matches =
      transaction.type === LedgerTransactionType.ENTRY_HOLD &&
      transaction.referenceType === 'ENTRY' &&
      typeof transactionEntryId === 'string' &&
      this.getMetadataString(transaction.metadata, 'roundId') ===
        args.roundId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'walletAccountId') ===
        args.walletAccountId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString();

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different entry hold.',
      );
    }

    this.assertEntryHoldLedgerShape(transaction);
  }

  private assertEntryHoldLedgerShape(
    transaction: LedgerTransactionWithEntries,
  ) {
    const debitEntries = transaction.entries.filter(
      (entry) => entry.direction === LedgerEntryDirection.DEBIT,
    );

    if (
      transaction.type !== LedgerTransactionType.ENTRY_HOLD ||
      transaction.referenceType !== 'ENTRY' ||
      debitEntries.length === 0
    ) {
      throw new BadRequestException(
        'Entry hold ledger transaction is invalid and requires review.',
      );
    }

    const walletAccountId = debitEntries[0].walletAccountId;
    const mixedWallet = debitEntries.some(
      (entry) => entry.walletAccountId !== walletAccountId,
    );

    if (mixedWallet) {
      throw new BadRequestException(
        'Entry hold has ledger entries from multiple wallets. Manual review required.',
      );
    }
  }

  private assertEntryHoldCompensationTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      holdTransactionId: string;
      holdIdempotencyKey: string;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.ENTRY_REFUND &&
      transaction.referenceType === 'ENTRY' &&
      this.getMetadataString(transaction.metadata, 'source') ===
        'ENTRY_HOLD_COMPENSATION' &&
      this.getMetadataString(transaction.metadata, 'holdTransactionId') ===
        args.holdTransactionId &&
      this.getMetadataString(transaction.metadata, 'holdIdempotencyKey') ===
        args.holdIdempotencyKey;

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different entry compensation.',
      );
    }
  }

  private assertRoundPayoutTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      userId: string;
      roundId: string;
      winnerEntryId: string;
      amount: bigint;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.ROUND_PAYOUT &&
      transaction.referenceType === 'ROUND' &&
      transaction.referenceId === args.roundId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'roundId') ===
        args.roundId &&
      this.getMetadataString(transaction.metadata, 'winnerEntryId') ===
        args.winnerEntryId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString();

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different round payout.',
      );
    }
  }

  private assertDepositCreditTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      userId: string;
      depositId: string;
      amount: bigint;
      currency: string;
      provider: string;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.DEPOSIT &&
      transaction.referenceType === 'DEPOSIT' &&
      transaction.referenceId === args.depositId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'depositId') ===
        args.depositId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString() &&
      this.getMetadataString(transaction.metadata, 'currency') ===
        args.currency &&
      this.getMetadataString(transaction.metadata, 'provider') ===
        args.provider;

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different deposit credit.',
      );
    }
  }

  private assertWithdrawalReserveTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      userId: string;
      withdrawalId: string;
      walletAccountId: string;
      amount: bigint;
      currency: string;
      provider: string;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.WITHDRAWAL_REQUEST &&
      transaction.referenceType === 'WITHDRAWAL' &&
      transaction.referenceId === args.withdrawalId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'withdrawalId') ===
        args.withdrawalId &&
      this.getMetadataString(transaction.metadata, 'walletAccountId') ===
        args.walletAccountId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString() &&
      this.getMetadataString(transaction.metadata, 'currency') ===
        args.currency &&
      this.getMetadataString(transaction.metadata, 'provider') ===
        args.provider;

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different withdrawal reserve.',
      );
    }
  }

  private assertWithdrawalRefundTransactionMatches(
    transaction: LedgerTransactionWithEntries,
    args: {
      userId: string;
      withdrawalId: string;
      walletAccountId: string;
      amount: bigint;
      currency: string;
      provider: string;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.WITHDRAWAL_REFUND &&
      transaction.referenceType === 'WITHDRAWAL' &&
      transaction.referenceId === args.withdrawalId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'withdrawalId') ===
        args.withdrawalId &&
      this.getMetadataString(transaction.metadata, 'walletAccountId') ===
        args.walletAccountId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString() &&
      this.getMetadataString(transaction.metadata, 'currency') ===
        args.currency &&
      this.getMetadataString(transaction.metadata, 'provider') ===
        args.provider;

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different withdrawal refund.',
      );
    }
  }

  private sumEntries(entries: LedgerEntry[]) {
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  }

  private getMetadataString(metadata: Prisma.JsonValue | null, key: string) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];

    return typeof value === 'string' ? value : null;
  }

  private toLedgerTransactionSnapshot(
    transaction: LedgerTransactionWithEntries,
  ): LedgerTransactionSnapshot {
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
        balanceAfterSnapshot: entry.balanceAfterSnapshot?.toString() ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
