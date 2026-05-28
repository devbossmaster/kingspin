import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PaymentProvider,
  Prisma,
  WithdrawalStatus,
  type Withdrawal,
} from "@kingspin/db";
import { CreateWithdrawalSchema } from "@kingspin/contracts";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { FraudService } from "../fraud/fraud.service";
import { WalletsService } from "../wallets/wallets.service";
import { PaymentsProviderRegistry } from "./payments-provider.registry";

@Injectable()
export class WithdrawalsService {
  private readonly transactionOptions = {
    maxWait: 5_000,
    timeout: 10_000,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly providerRegistry: PaymentsProviderRegistry,
    private readonly fraudService: FraudService,
  ) {}

  async requestWithdrawal(userId: string, body: unknown) {
    const parsed = CreateWithdrawalSchema.parse(body);
    const amount = BigInt(parsed.amount);
    const provider =
      parsed.provider ?? this.providerRegistry.getDefaultProvider();
    const currency = parsed.currency;
    const destination = parsed.destination as Prisma.InputJsonObject;

    const existing = await this.prisma.withdrawal.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
    });

    if (existing) {
      this.assertWithdrawalMatches(existing, {
        userId,
        provider,
        amount,
        currency,
      });

      return {
        withdrawal: this.toWithdrawalSnapshot(existing),
        reused: true,
      };
    }

    const wallet = await this.walletsService.ensureMainWalletForUserId(userId);
    const withdrawalId = randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.create({
        data: {
          id: withdrawalId,
          userId,
          walletAccountId: wallet.id,
          provider,
          amount,
          currency,
          destination,
          status: WithdrawalStatus.PENDING_REVIEW,
          idempotencyKey: parsed.idempotencyKey,
          metadata: parsed.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      const reserve = await this.walletsService.reserveWithdrawalInTransaction(
        tx,
        {
          userId,
          withdrawalId: withdrawal.id,
          walletAccountId: withdrawal.walletAccountId,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          provider: withdrawal.provider,
        },
      );

      return {
        withdrawal,
        wallet: reserve.wallet,
        transaction: reserve.transaction,
      };
    }, this.transactionOptions);

    await this.flagWithdrawalSpike(result.withdrawal);

    return {
      withdrawal: this.toWithdrawalSnapshot(result.withdrawal),
      wallet: result.wallet,
      transaction: result.transaction,
      reused: false,
    };
  }

  async listWithdrawals(filters: {
    userId?: string;
    status?: WithdrawalStatus;
    take?: number;
  }) {
    const take = Math.max(1, Math.min(filters.take ?? 50, 200));
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: {
        userId: filters.userId,
        status: filters.status,
      },
      orderBy: { requestedAt: "desc" },
      take,
    });

    return withdrawals.map((withdrawal) =>
      this.toWithdrawalSnapshot(withdrawal),
    );
  }

  async approveWithdrawal(withdrawalId: string, adminId: string) {
    const withdrawal = await this.findWithdrawalOrThrow(withdrawalId);

    if (withdrawal.status === WithdrawalStatus.APPROVED) {
      return {
        withdrawal: this.toWithdrawalSnapshot(withdrawal),
        reused: true,
      };
    }

    if (withdrawal.status !== WithdrawalStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `Withdrawal cannot be approved from ${withdrawal.status}.`,
      );
    }

    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: WithdrawalStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedByAdminId: adminId,
      },
    });

    return {
      withdrawal: this.toWithdrawalSnapshot(updated),
      reused: false,
    };
  }

  async createPayout(withdrawalId: string) {
    const withdrawal = await this.findWithdrawalOrThrow(withdrawalId);

    if (withdrawal.status === WithdrawalStatus.PAID) {
      return {
        withdrawal: this.toWithdrawalSnapshot(withdrawal),
        reused: true,
      };
    }

    if (
      withdrawal.status !== WithdrawalStatus.APPROVED &&
      withdrawal.status !== WithdrawalStatus.PROCESSING &&
      withdrawal.status !== WithdrawalStatus.FAILED
    ) {
      throw new BadRequestException(
        `Withdrawal payout cannot start from ${withdrawal.status}.`,
      );
    }

    if (withdrawal.providerReference) {
      return {
        withdrawal: this.toWithdrawalSnapshot(withdrawal),
        reused: true,
      };
    }

    const adapter = this.providerRegistry.getProvider(withdrawal.provider);
    const payout = await adapter.createWithdrawalPayout({
      withdrawalId: withdrawal.id,
      userId: withdrawal.userId,
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      destination: this.toJsonRecord(withdrawal.destination),
      idempotencyKey: `withdrawal-payout:${withdrawal.id}`,
    });

    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status:
          payout.status === "PAID"
            ? WithdrawalStatus.PAID
            : WithdrawalStatus.PROCESSING,
        providerReference: payout.providerReference,
        paidAt: payout.status === "PAID" ? new Date() : null,
        metadata: this.mergeMetadata(
          withdrawal.metadata,
          (payout.metadata ?? {}) as Prisma.InputJsonObject,
        ),
      },
    });

    return {
      withdrawal: this.toWithdrawalSnapshot(updated),
      reused: false,
    };
  }

  async markPaid(
    withdrawalId: string,
    adminId: string,
    providerReference?: string,
  ) {
    const withdrawal = await this.findWithdrawalOrThrow(withdrawalId);

    if (withdrawal.status === WithdrawalStatus.PAID) {
      return {
        withdrawal: this.toWithdrawalSnapshot(withdrawal),
        reused: true,
      };
    }

    if (
      withdrawal.status !== WithdrawalStatus.APPROVED &&
      withdrawal.status !== WithdrawalStatus.PROCESSING
    ) {
      throw new BadRequestException(
        `Withdrawal cannot be marked paid from ${withdrawal.status}.`,
      );
    }

    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: WithdrawalStatus.PAID,
        providerReference:
          providerReference ?? withdrawal.providerReference ?? undefined,
        paidAt: new Date(),
        reviewedByAdminId: withdrawal.reviewedByAdminId ?? adminId,
        reviewedAt: withdrawal.reviewedAt ?? new Date(),
      },
    });

    return {
      withdrawal: this.toWithdrawalSnapshot(updated),
      reused: false,
    };
  }

  async rejectWithdrawal(
    withdrawalId: string,
    adminId: string,
    reason: string,
  ) {
    return this.refundAndTransition(withdrawalId, adminId, {
      status: WithdrawalStatus.REJECTED,
      reason,
    });
  }

  async markFailed(withdrawalId: string, adminId: string, reason: string) {
    return this.refundAndTransition(withdrawalId, adminId, {
      status: WithdrawalStatus.FAILED,
      reason,
    });
  }

  async cancelWithdrawal(withdrawalId: string, userId: string) {
    const withdrawal = await this.findWithdrawalOrThrow(withdrawalId);

    if (withdrawal.userId !== userId) {
      throw new NotFoundException("Withdrawal not found.");
    }

    return this.refundAndTransition(withdrawalId, userId, {
      status: WithdrawalStatus.CANCELLED,
      reason: "Cancelled by user before payout.",
      reviewerIsUser: true,
    });
  }

  async handleWithdrawalWebhook(
    provider: PaymentProvider,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const adapter = this.providerRegistry.getProvider(provider);
    const verified = await adapter.verifyWithdrawalWebhook({ body, headers });

    if (!verified.valid || !verified.providerReference) {
      await this.fraudService.createRiskEvent({
        type: "PAYMENT_FAILURE_PATTERN",
        severity: "MEDIUM",
        metadata: {
          provider,
          reason: verified.reason ?? "Invalid withdrawal webhook.",
        },
      });

      throw new BadRequestException("Invalid withdrawal webhook.");
    }

    const withdrawal = await this.prisma.withdrawal.findFirst({
      where: {
        provider,
        providerReference: verified.providerReference,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException("Withdrawal not found for provider reference.");
    }

    if (verified.status === "PAID") {
      return this.markPaid(withdrawal.id, withdrawal.reviewedByAdminId ?? "");
    }

    if (verified.status === "FAILED" || verified.status === "CANCELLED") {
      return this.refundAndTransition(withdrawal.id, withdrawal.reviewedByAdminId ?? "", {
        status:
          verified.status === "FAILED"
            ? WithdrawalStatus.FAILED
            : WithdrawalStatus.CANCELLED,
        reason: verified.reason ?? `Provider reported ${verified.status}.`,
      });
    }

    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: WithdrawalStatus.PROCESSING,
        metadata: this.mergeMetadata(
          withdrawal.metadata,
          (verified.metadata ?? {}) as Prisma.InputJsonObject,
        ),
      },
    });

    return {
      withdrawal: this.toWithdrawalSnapshot(updated),
      reused: false,
    };
  }

  toWithdrawalSnapshot(withdrawal: Withdrawal) {
    return {
      id: withdrawal.id,
      userId: withdrawal.userId,
      walletAccountId: withdrawal.walletAccountId,
      provider: withdrawal.provider,
      amount: withdrawal.amount.toString(),
      currency: withdrawal.currency,
      status: withdrawal.status,
      providerReference: withdrawal.providerReference,
      requestedAt: withdrawal.requestedAt.toISOString(),
      reviewedAt: withdrawal.reviewedAt?.toISOString() ?? null,
      reviewedByAdminId: withdrawal.reviewedByAdminId,
      paidAt: withdrawal.paidAt?.toISOString() ?? null,
      rejectionReason: withdrawal.rejectionReason,
      idempotencyKey: withdrawal.idempotencyKey,
      metadata: withdrawal.metadata,
      createdAt: withdrawal.createdAt.toISOString(),
      updatedAt: withdrawal.updatedAt.toISOString(),
    };
  }

  private async refundAndTransition(
    withdrawalId: string,
    actorId: string,
    args: {
      status:
        | typeof WithdrawalStatus.REJECTED
        | typeof WithdrawalStatus.FAILED
        | typeof WithdrawalStatus.CANCELLED;
      reason: string;
      reviewerIsUser?: boolean;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
      });

      if (!withdrawal) {
        throw new NotFoundException("Withdrawal not found.");
      }

      if (
        withdrawal.status === WithdrawalStatus.PAID ||
        withdrawal.status === WithdrawalStatus.CANCELLED ||
        withdrawal.status === WithdrawalStatus.REJECTED
      ) {
        return {
          withdrawal: this.toWithdrawalSnapshot(withdrawal),
          reused: true,
        };
      }

      const updated = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: args.status,
          rejectionReason: args.reason,
          reviewedAt: args.reviewerIsUser
            ? withdrawal.reviewedAt
            : (withdrawal.reviewedAt ?? new Date()),
          reviewedByAdminId: args.reviewerIsUser
            ? withdrawal.reviewedByAdminId
            : (withdrawal.reviewedByAdminId ?? (actorId || null)),
        },
      });

      const refund = await this.walletsService.refundWithdrawalInTransaction(
        tx,
        {
          userId: updated.userId,
          withdrawalId: updated.id,
          walletAccountId: updated.walletAccountId,
          amount: updated.amount,
          currency: updated.currency,
          provider: updated.provider,
          reason: args.reason,
        },
      );

      return {
        withdrawal: this.toWithdrawalSnapshot(updated),
        wallet: refund.wallet,
        transaction: refund.transaction,
        reused: refund.reused,
      };
    }, this.transactionOptions);
  }

  private async findWithdrawalOrThrow(withdrawalId: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundException("Withdrawal not found.");
    }

    return withdrawal;
  }

  private assertWithdrawalMatches(
    withdrawal: Withdrawal,
    expected: {
      userId: string;
      provider: PaymentProvider;
      amount: bigint;
      currency: string;
    },
  ) {
    if (
      withdrawal.userId !== expected.userId ||
      withdrawal.provider !== expected.provider ||
      withdrawal.amount !== expected.amount ||
      withdrawal.currency !== expected.currency
    ) {
      throw new BadRequestException(
        "Idempotency key was already used for a different withdrawal request.",
      );
    }
  }

  private async flagWithdrawalSpike(withdrawal: Withdrawal) {
    const recent = await this.prisma.withdrawal.aggregate({
      where: {
        userId: withdrawal.userId,
        requestedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });
    const recentAmount = recent._sum.amount ?? 0n;

    if (recent._count >= 3 || recentAmount >= withdrawal.amount * 3n) {
      await this.fraudService.createRiskEvent({
        userId: withdrawal.userId,
        type: "WITHDRAWAL_AMOUNT_SPIKE",
        severity: "MEDIUM",
        metadata: {
          withdrawalId: withdrawal.id,
          recentWithdrawalCount: recent._count,
          recentWithdrawalAmount: recentAmount.toString(),
        },
      });
    }
  }

  private toJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private mergeMetadata(
    existing: Prisma.JsonValue | null,
    next: Prisma.InputJsonValue,
  ) {
    return {
      ...(existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : {}),
      ...(next && typeof next === "object" && !Array.isArray(next)
        ? next
        : {}),
    };
  }
}
