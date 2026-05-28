import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DepositStatus,
  PaymentProvider,
  Prisma,
  type Deposit,
} from "@kingspin/db";
import { CreateDepositSchema } from "@kingspin/contracts";
import { randomUUID } from "node:crypto";
import { getApiEnv } from "../../config/api-env";
import { PrismaService } from "../../prisma/prisma.service";
import { FraudService } from "../fraud/fraud.service";
import { WalletsService } from "../wallets/wallets.service";
import { PaymentsProviderRegistry } from "./payments-provider.registry";

@Injectable()
export class DepositsService {
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

  async createDeposit(userId: string, body: unknown) {
    const parsed = CreateDepositSchema.parse(body);
    const amount = BigInt(parsed.amount);
    const provider = parsed.provider ?? this.providerRegistry.getDefaultProvider();
    const currency = parsed.currency;
    const existing = await this.prisma.deposit.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
    });

    if (existing) {
      this.assertDepositMatches(existing, {
        userId,
        provider,
        amount,
        currency,
      });

      return {
        deposit: this.toDepositSnapshot(existing),
        reused: true,
      };
    }

    const depositId = randomUUID();
    const adapter = this.providerRegistry.getProvider(provider);
    const intent = await adapter.createDepositIntent({
      depositId,
      userId,
      amount,
      currency,
      idempotencyKey: parsed.idempotencyKey,
      metadata: parsed.metadata,
    });

    const deposit = await this.prisma.deposit.create({
      data: {
        id: depositId,
        userId,
        provider,
        providerReference: intent.providerReference,
        amount,
        currency,
        status: DepositStatus.PENDING,
        idempotencyKey: parsed.idempotencyKey,
        metadata: {
          ...(parsed.metadata ?? {}),
          ...(intent.metadata ?? {}),
          checkoutUrl: intent.checkoutUrl ?? null,
        },
      },
    });

    return {
      deposit: this.toDepositSnapshot(deposit),
      checkoutUrl: intent.checkoutUrl ?? null,
      reused: false,
    };
  }

  async listDeposits(filters: {
    userId?: string;
    status?: DepositStatus;
    take?: number;
  }) {
    const take = Math.max(1, Math.min(filters.take ?? 50, 200));
    const deposits = await this.prisma.deposit.findMany({
      where: {
        userId: filters.userId,
        status: filters.status,
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return deposits.map((deposit) => this.toDepositSnapshot(deposit));
  }

  async confirmDepositById(depositId: string, metadata?: Prisma.InputJsonValue) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({
        where: { id: depositId },
      });

      if (!deposit) {
        throw new NotFoundException("Deposit not found.");
      }

      if (deposit.status === DepositStatus.CONFIRMED) {
        const credit = await this.walletsService.creditDepositInTransaction(tx, {
          userId: deposit.userId,
          depositId: deposit.id,
          amount: deposit.amount,
          currency: deposit.currency,
          provider: deposit.provider,
        });

        return {
          deposit: this.toDepositSnapshot(deposit),
          wallet: credit.wallet,
          transaction: credit.transaction,
          reused: true,
        };
      }

      if (deposit.status !== DepositStatus.PENDING) {
        throw new BadRequestException(
          `Deposit cannot be confirmed from ${deposit.status}.`,
        );
      }

      const updated = await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          status: DepositStatus.CONFIRMED,
          confirmedAt: new Date(),
          metadata:
            metadata === undefined
              ? undefined
              : this.mergeMetadata(deposit.metadata, metadata),
        },
      });
      const credit = await this.walletsService.creditDepositInTransaction(tx, {
        userId: updated.userId,
        depositId: updated.id,
        amount: updated.amount,
        currency: updated.currency,
        provider: updated.provider,
      });

      return {
        deposit: this.toDepositSnapshot(updated),
        wallet: credit.wallet,
        transaction: credit.transaction,
        reused: credit.reused,
      };
    }, this.transactionOptions);
  }

  async approveManualDeposit(depositId: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
    });

    if (!deposit) {
      throw new NotFoundException("Deposit not found.");
    }

    if (
      deposit.provider !== PaymentProvider.MANUAL &&
      deposit.provider !== PaymentProvider.MOCK
    ) {
      throw new BadRequestException(
        "Only MANUAL or MOCK deposits can be manually approved.",
      );
    }

    if (deposit.provider === PaymentProvider.MOCK && getApiEnv().APP_ENV !== "local") {
      throw new BadRequestException("MOCK deposit approval is local-only.");
    }

    return this.confirmDepositById(deposit.id, {
      manualApproval: true,
      approvedAt: new Date().toISOString(),
    });
  }

  async handleDepositWebhook(provider: PaymentProvider, body: unknown, headers: Record<string, string | string[] | undefined>) {
    const adapter = this.providerRegistry.getProvider(provider);
    const verified = await adapter.verifyDepositWebhook({ body, headers });

    if (!verified.valid || !verified.providerReference) {
      await this.fraudService.createRiskEvent({
        type: "DEPOSIT_WEBHOOK_MISMATCH",
        severity: "MEDIUM",
        metadata: {
          provider,
          reason: verified.reason ?? "Invalid deposit webhook.",
        },
      });

      throw new BadRequestException("Invalid deposit webhook.");
    }

    const deposit = await this.prisma.deposit.findFirst({
      where: {
        provider,
        providerReference: verified.providerReference,
      },
    });

    if (!deposit) {
      await this.fraudService.createRiskEvent({
        type: "DEPOSIT_WEBHOOK_MISMATCH",
        severity: "HIGH",
        metadata: {
          provider,
          providerReference: verified.providerReference,
          reason: "Webhook deposit reference not found.",
        },
      });

      throw new NotFoundException("Deposit not found for provider reference.");
    }

    if (
      verified.amount !== undefined &&
      (verified.amount !== deposit.amount ||
        (verified.currency ?? deposit.currency) !== deposit.currency)
    ) {
      await this.fraudService.createRiskEvent({
        userId: deposit.userId,
        type: "DEPOSIT_WEBHOOK_MISMATCH",
        severity: "HIGH",
        metadata: {
          provider,
          providerReference: verified.providerReference,
          expectedAmount: deposit.amount.toString(),
          receivedAmount: verified.amount.toString(),
          expectedCurrency: deposit.currency,
          receivedCurrency: verified.currency,
        },
      });

      throw new BadRequestException("Deposit webhook amount mismatch.");
    }

    if (verified.status === "CONFIRMED") {
      return this.confirmDepositById(
        deposit.id,
        verified.metadata as Prisma.InputJsonObject | undefined,
      );
    }

    if (
      verified.status === "FAILED" ||
      verified.status === "EXPIRED" ||
      verified.status === "CANCELLED"
    ) {
      const updated = await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          status: verified.status,
          metadata: this.mergeMetadata(
            deposit.metadata,
            (verified.metadata ?? {}) as Prisma.InputJsonObject,
          ),
        },
      });

      return {
        deposit: this.toDepositSnapshot(updated),
        reused: false,
      };
    }

    return {
      deposit: this.toDepositSnapshot(deposit),
      reused: true,
    };
  }

  toDepositSnapshot(deposit: Deposit) {
    return {
      id: deposit.id,
      userId: deposit.userId,
      provider: deposit.provider,
      providerReference: deposit.providerReference,
      amount: deposit.amount.toString(),
      currency: deposit.currency,
      status: deposit.status,
      idempotencyKey: deposit.idempotencyKey,
      metadata: deposit.metadata,
      createdAt: deposit.createdAt.toISOString(),
      updatedAt: deposit.updatedAt.toISOString(),
      confirmedAt: deposit.confirmedAt?.toISOString() ?? null,
    };
  }

  private assertDepositMatches(
    deposit: Deposit,
    expected: {
      userId: string;
      provider: PaymentProvider;
      amount: bigint;
      currency: string;
    },
  ) {
    if (
      deposit.userId !== expected.userId ||
      deposit.provider !== expected.provider ||
      deposit.amount !== expected.amount ||
      deposit.currency !== expected.currency
    ) {
      throw new BadRequestException(
        "Idempotency key was already used for a different deposit request.",
      );
    }
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
