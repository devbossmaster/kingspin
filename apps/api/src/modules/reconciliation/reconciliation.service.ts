import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LedgerEntryDirection, WalletAccountType } from "@kingspin/db";
import { PrismaService } from "../../prisma/prisma.service";

type LedgerEntryForReconciliation = {
  direction: LedgerEntryDirection;
  amount: bigint;
};

type WalletForReconciliation = {
  id: string;
  userId: string | null;
  type: WalletAccountType;
  balanceSnapshot: bigint;
  ledgerEntries: LedgerEntryForReconciliation[];
};

export type WalletReconciliationResult = {
  walletAccountId: string;
  userId: string | null;
  type: WalletAccountType;
  balanceSnapshot: string;
  ledgerBalance: string;
  driftAmount: string;
  hasDrift: boolean;
  checkedAt: string;
};

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcileWallet(
    walletAccountId: string,
  ): Promise<WalletReconciliationResult> {
    if (!walletAccountId) {
      throw new BadRequestException("walletAccountId is required.");
    }

    const wallet = await this.prisma.walletAccount.findUnique({
      where: { id: walletAccountId },
      include: {
        ledgerEntries: {
          select: {
            direction: true,
            amount: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException("Wallet account not found.");
    }

    return this.toReconciliationResult(wallet, new Date());
  }

  async scanWallets(options: { take?: number; onlyDrift?: boolean } = {}) {
    const checkedAt = new Date();
    const take = Math.max(1, Math.min(options.take ?? 100, 500));

    // TODO(reconciliation): replace this skeleton scan with SQL aggregate
    // queries or materialized ledger balances before running against large
    // production ledgers. This intentionally reports drift only and never
    // mutates wallet snapshots.
    const wallets = await this.prisma.walletAccount.findMany({
      take,
      orderBy: { createdAt: "asc" },
      include: {
        ledgerEntries: {
          select: {
            direction: true,
            amount: true,
          },
        },
      },
    });

    const results = wallets.map((wallet) =>
      this.toReconciliationResult(wallet, checkedAt),
    );
    const filtered = options.onlyDrift
      ? results.filter((result) => result.hasDrift)
      : results;

    return {
      checkedAt: checkedAt.toISOString(),
      scannedWalletCount: wallets.length,
      driftCount: results.filter((result) => result.hasDrift).length,
      results: filtered,
      autoCorrected: false,
    };
  }

  getMigrationTodos() {
    return [
      "Add a reconciliation_runs table to persist scan metadata, actor, totals, and status.",
      "Add reconciliation_findings table for wallet drift snapshots and review state.",
      "Use database-side aggregates for ledger sums before scanning production-sized ledgers.",
      "Add admin-reviewed correction workflows; never silently mutate balances from reconciliation.",
    ];
  }

  private toReconciliationResult(
    wallet: WalletForReconciliation,
    checkedAt: Date,
  ): WalletReconciliationResult {
    const ledgerBalance = wallet.ledgerEntries.reduce((sum, entry) => {
      if (entry.direction === LedgerEntryDirection.CREDIT) {
        return sum + entry.amount;
      }

      return sum - entry.amount;
    }, 0n);
    const driftAmount = wallet.balanceSnapshot - ledgerBalance;

    return {
      walletAccountId: wallet.id,
      userId: wallet.userId,
      type: wallet.type,
      balanceSnapshot: wallet.balanceSnapshot.toString(),
      ledgerBalance: ledgerBalance.toString(),
      driftAmount: driftAmount.toString(),
      hasDrift: driftAmount !== 0n,
      checkedAt: checkedAt.toISOString(),
    };
  }
}
