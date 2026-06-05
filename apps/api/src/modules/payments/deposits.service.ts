import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepositIntent,
  DepositStatus,
  PaymentProvider,
  Prisma,
  VerificationAttemptStatus,
  type Deposit,
} from '@kingspin/db';
import {
  CreateDepositSchema,
  SubmitTelebirrReceiptSchema,
} from '@kingspin/contracts';
import { randomUUID } from 'node:crypto';
import { getApiEnv } from '../../config/api-env';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  decimalAmountToWholeWalletUnits,
  normalizeMoneyAmount,
} from './domain/money';
import { PaymentsProviderRegistry } from './payments-provider.registry';
import { normalizeDecimalString } from './providers/telebirr-receipt/telebirr-receipt.parser';
import { TelebirrReceiptProvider } from './providers/telebirr-receipt/telebirr-receipt.provider';
import type { ParsedTelebirrReceipt } from './providers/telebirr-receipt/telebirr-receipt.types';

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
    private readonly telebirrReceiptProvider: TelebirrReceiptProvider,
  ) {}

  async createDeposit(userId: string, body: unknown) {
    const parsed = CreateDepositSchema.parse(body);
    const provider =
      parsed.provider ?? this.providerRegistry.getDefaultProvider();

    if (provider === PaymentProvider.TELEBIRR_RECEIPT) {
      return this.createTelebirrDepositIntent(userId, parsed);
    }

    const amount =
      typeof parsed.amount === 'number'
        ? BigInt(parsed.amount)
        : decimalAmountToWholeWalletUnits(parsed.amount);
    const currency = parsed.currency;
    const idempotencyKey =
      parsed.idempotencyKey ?? `deposit:${userId}:${randomUUID()}`;
    const existing = await this.prisma.deposit.findUnique({
      where: { idempotencyKey },
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
      idempotencyKey,
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
        idempotencyKey,
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

  private async createTelebirrDepositIntent(
    userId: string,
    parsed: ReturnType<typeof CreateDepositSchema.parse>,
  ) {
    const config = this.telebirrReceiptProvider.getConfig();

    if (!config.enabled) {
      throw new BadRequestException(
        'Telebirr receipt verification is not enabled.',
      );
    }

    const expectedAmount = normalizeMoneyAmount(parsed.amount);
    const numericAmount = Number(expectedAmount);

    if (
      numericAmount < config.minDeposit ||
      numericAmount > config.maxDeposit
    ) {
      throw new BadRequestException(
        `Telebirr deposit amount must be between ${config.minDeposit} and ${config.maxDeposit} ETB.`,
      );
    }

    decimalAmountToWholeWalletUnits(expectedAmount);

    const idempotencyKey =
      parsed.idempotencyKey ??
      `deposit:telebirr-intent:${userId}:${randomUUID()}`;

    const existing = await this.prisma.depositIntent.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      if (
        existing.userId !== userId ||
        existing.provider !== PaymentProvider.TELEBIRR_RECEIPT ||
        this.decimalToString(existing.expectedAmount) !== expectedAmount
      ) {
        throw new BadRequestException(
          'Idempotency key was already used for a different deposit request.',
        );
      }

      return {
        deposit: this.toDepositIntentSnapshot(existing),
        instructions: this.toTelebirrInstructions(existing),
        reused: true,
      };
    }

    const expiresAt = new Date(
      Date.now() + config.intentTtlMinutes * 60 * 1000,
    );
    const depositIntent = await this.prisma.depositIntent.create({
      data: {
        userId,
        provider: PaymentProvider.TELEBIRR_RECEIPT,
        status: DepositStatus.PENDING,
        expectedAmount: new Prisma.Decimal(expectedAmount),
        currency: 'ETB',
        receiverName: config.expectedReceiverName,
        receiverAccount: config.expectedReceiverAccount,
        receiverShortCode: config.expectedShortCode,
        expiresAt,
        idempotencyKey,
      },
    });

    return {
      deposit: this.toDepositIntentSnapshot(depositIntent),
      instructions: this.toTelebirrInstructions(depositIntent),
      reused: false,
    };
  }

  async submitTelebirrReceipt(
    userId: string,
    depositIntentId: string,
    body: unknown,
  ) {
    const parsed = SubmitTelebirrReceiptSchema.parse(body);
    const receiptNo = this.telebirrReceiptProvider.normalizeReceiptInput(
      parsed.receiptInput,
    );
    const intent = await this.findDepositIntentForUser(userId, depositIntentId);

    await this.assertVerificationAttemptAllowed(userId, intent, receiptNo);

    const duplicate = await this.prisma.depositIntent.findFirst({
      where: {
        receiptNo,
        id: { not: intent.id },
      },
    });

    if (duplicate) {
      await this.recordTelebirrAttempt({
        intent,
        submittedValue: parsed.receiptInput,
        receiptNo,
        status: VerificationAttemptStatus.REJECTED,
        reason: 'Receipt number has already been used.',
      });
      await this.fraudService.createRiskEvent({
        userId,
        type: 'DEPOSIT_WEBHOOK_MISMATCH',
        severity: 'HIGH',
        metadata: {
          reason: 'Duplicate Telebirr receipt submission.',
          receiptNo,
          depositIntentId: intent.id,
          existingDepositIntentId: duplicate.id,
        },
      });

      const rejected = await this.prisma.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: DepositStatus.REJECTED,
          rejectionReason: 'Receipt number has already been used.',
        },
      });

      return {
        deposit: this.toDepositIntentSnapshot(rejected),
        reused: false,
      };
    }

    await this.prisma.depositIntent.update({
      where: { id: intent.id },
      data: { status: DepositStatus.VERIFYING },
    });

    let verification: Awaited<
      ReturnType<TelebirrReceiptProvider['fetchAndParseReceipt']>
    >;

    try {
      verification =
        await this.telebirrReceiptProvider.fetchAndParseReceipt(receiptNo);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'Telebirr receipt fetch failed.';
      const reviewed = await this.markIntentForReview(
        intent.id,
        'Official receipt could not be fetched.',
      );

      await this.recordTelebirrAttempt({
        intent: reviewed,
        submittedValue: parsed.receiptInput,
        receiptNo,
        status: VerificationAttemptStatus.FETCH_FAILED,
        reason,
      });

      return {
        deposit: this.toDepositIntentSnapshot(reviewed),
        reused: false,
      };
    }

    const decision = this.evaluateTelebirrReceipt(
      intent,
      receiptNo,
      verification.parsed,
    );

    if (decision.status === 'ACCEPT') {
      const credited = await this.creditTelebirrDepositIntent({
        depositIntentId: intent.id,
        receiptNo,
        rawProviderHash: verification.rawProviderHash,
      });

      await this.recordTelebirrAttempt({
        intent: credited.depositIntent,
        submittedValue: parsed.receiptInput,
        receiptNo,
        status: VerificationAttemptStatus.ACCEPTED,
        reason: 'Receipt verified and credited.',
        verification,
      });

      return {
        deposit: this.toDepositIntentSnapshot(credited.depositIntent),
        wallet: credited.wallet,
        transaction: credited.transaction,
        reused: credited.reused,
      };
    }

    const updated = await this.prisma.depositIntent.update({
      where: { id: intent.id },
      data:
        decision.status === 'REJECT'
          ? {
              status: DepositStatus.REJECTED,
              rejectionReason: decision.reason,
              providerRef: receiptNo,
              receiptNo,
              rawProviderHash: verification.rawProviderHash,
              verifiedAt: new Date(),
            }
          : {
              status: DepositStatus.NEEDS_MANUAL_REVIEW,
              reviewReason: decision.reason,
              providerRef: receiptNo,
              receiptNo,
              rawProviderHash: verification.rawProviderHash,
              verifiedAt: new Date(),
            },
    });

    await this.recordTelebirrAttempt({
      intent: updated,
      submittedValue: parsed.receiptInput,
      receiptNo,
      status:
        decision.status === 'REJECT'
          ? VerificationAttemptStatus.REJECTED
          : VerificationAttemptStatus.NEEDS_MANUAL_REVIEW,
      reason: decision.reason,
      verification,
    });

    return {
      deposit: this.toDepositIntentSnapshot(updated),
      reused: false,
    };
  }

  async getDepositStatus(userId: string, depositIntentId: string) {
    const intent = await this.findDepositIntentForUser(userId, depositIntentId);

    return this.toDepositIntentSnapshot(intent);
  }

  async listDeposits(filters: {
    userId?: string;
    status?: DepositStatus;
    take?: number;
  }) {
    const take = Math.max(1, Math.min(filters.take ?? 50, 200));
    const [deposits, intents] = await Promise.all([
      this.prisma.deposit.findMany({
        where: {
          userId: filters.userId,
          status: filters.status,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.depositIntent.findMany({
        where: {
          userId: filters.userId,
          status: filters.status,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);

    return [
      ...deposits.map((deposit) => this.toDepositSnapshot(deposit)),
      ...intents.map((intent) => this.toDepositIntentSnapshot(intent)),
    ]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, take);
  }

  async confirmDepositById(
    depositId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({
        where: { id: depositId },
      });

      if (!deposit) {
        throw new NotFoundException('Deposit not found.');
      }

      if (deposit.status === DepositStatus.CONFIRMED) {
        const credit = await this.walletsService.creditDepositInTransaction(
          tx,
          {
            userId: deposit.userId,
            depositId: deposit.id,
            amount: deposit.amount,
            currency: deposit.currency,
            provider: deposit.provider,
          },
        );

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
      throw new NotFoundException('Deposit not found.');
    }

    if (
      deposit.provider !== PaymentProvider.MANUAL &&
      deposit.provider !== PaymentProvider.MOCK
    ) {
      throw new BadRequestException(
        'Only MANUAL or MOCK deposits can be manually approved.',
      );
    }

    if (
      deposit.provider === PaymentProvider.MOCK &&
      getApiEnv().APP_ENV !== 'local'
    ) {
      throw new BadRequestException('MOCK deposit approval is local-only.');
    }

    return this.confirmDepositById(deposit.id, {
      manualApproval: true,
      approvedAt: new Date().toISOString(),
    });
  }

  async getAdminDeposit(depositId: string) {
    const intent = await this.prisma.depositIntent.findUnique({
      where: { id: depositId },
      include: {
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (intent) {
      return {
        deposit: this.toDepositIntentSnapshot(intent),
        attempts: intent.attempts.map((attempt) => ({
          id: attempt.id,
          normalizedRef: attempt.normalizedRef,
          status: attempt.status,
          reason: attempt.reason,
          httpStatus: attempt.httpStatus,
          providerStatus: attempt.providerStatus,
          parsedAmount: attempt.parsedAmount?.toString() ?? null,
          parsedCurrency: attempt.parsedCurrency,
          parsedReceiver: attempt.parsedReceiver,
          parsedPayer: attempt.parsedPayer,
          parsedPaidAt: attempt.parsedPaidAt?.toISOString() ?? null,
          rawProviderHash: attempt.rawProviderHash,
          createdAt: attempt.createdAt.toISOString(),
        })),
      };
    }

    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found.');
    }

    return {
      deposit: this.toDepositSnapshot(deposit),
      attempts: [],
    };
  }

  async approveReviewedDeposit(depositId: string, adminNote: string) {
    if (!adminNote?.trim()) {
      throw new BadRequestException('Admin note is required.');
    }

    const intent = await this.prisma.depositIntent.findUnique({
      where: { id: depositId },
    });

    if (!intent) {
      return this.approveManualDeposit(depositId);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${depositId})::bigint)
      `;

      const current = await tx.depositIntent.findUnique({
        where: { id: depositId },
      });

      if (!current) {
        throw new NotFoundException('Deposit not found.');
      }

      const amount = decimalAmountToWholeWalletUnits(
        this.decimalToString(current.expectedAmount),
      );
      const idempotencyKey = current.receiptNo
        ? `deposit:telebirr-receipt:${current.receiptNo}`
        : `deposit:manual-approve:${current.id}`;

      if (current.status === DepositStatus.CREDITED) {
        const credit = await this.walletsService.creditDepositInTransaction(
          tx,
          {
            userId: current.userId,
            depositId: current.id,
            amount,
            currency: current.currency,
            provider: current.provider,
            idempotencyKey,
          },
        );

        return {
          deposit: this.toDepositIntentSnapshot(current),
          wallet: credit.wallet,
          transaction: credit.transaction,
          reused: true,
        };
      }

      if (current.status !== DepositStatus.NEEDS_MANUAL_REVIEW) {
        throw new BadRequestException(
          `Deposit cannot be manually approved from ${current.status}.`,
        );
      }

      const credit = await this.walletsService.creditDepositInTransaction(tx, {
        userId: current.userId,
        depositId: current.id,
        amount,
        currency: current.currency,
        provider: current.provider,
        idempotencyKey,
      });
      const credited = await tx.depositIntent.update({
        where: { id: current.id },
        data: {
          status: DepositStatus.CREDITED,
          reviewReason: `Manually approved: ${adminNote.trim()}`,
          creditedAt: new Date(),
          verifiedAt: current.verifiedAt ?? new Date(),
          creditedWalletEntryId: credit.transaction.entries[0]?.id ?? null,
        },
      });

      return {
        deposit: this.toDepositIntentSnapshot(credited),
        wallet: credit.wallet,
        transaction: credit.transaction,
        reused: credit.reused,
      };
    }, this.transactionOptions);
  }

  async rejectDeposit(depositId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('Rejection reason is required.');
    }

    const intent = await this.prisma.depositIntent.findUnique({
      where: { id: depositId },
    });

    if (intent) {
      const updated = await this.prisma.depositIntent.update({
        where: { id: depositId },
        data: {
          status: DepositStatus.REJECTED,
          rejectionReason: reason.trim(),
        },
      });

      return {
        deposit: this.toDepositIntentSnapshot(updated),
        reused: false,
      };
    }

    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found.');
    }

    const updated = await this.prisma.deposit.update({
      where: { id: depositId },
      data: {
        status: DepositStatus.REJECTED,
        metadata: this.mergeMetadata(deposit.metadata, {
          rejectionReason: reason.trim(),
        }),
      },
    });

    return {
      deposit: this.toDepositSnapshot(updated),
      reused: false,
    };
  }

  async handleDepositWebhook(
    provider: PaymentProvider,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const adapter = this.providerRegistry.getProvider(provider);
    const verified = await adapter.verifyDepositWebhook({ body, headers });

    if (!verified.valid || !verified.providerReference) {
      await this.fraudService.createRiskEvent({
        type: 'DEPOSIT_WEBHOOK_MISMATCH',
        severity: 'MEDIUM',
        metadata: {
          provider,
          reason: verified.reason ?? 'Invalid deposit webhook.',
        },
      });

      throw new BadRequestException('Invalid deposit webhook.');
    }

    const deposit = await this.prisma.deposit.findFirst({
      where: {
        provider,
        providerReference: verified.providerReference,
      },
    });

    if (!deposit) {
      await this.fraudService.createRiskEvent({
        type: 'DEPOSIT_WEBHOOK_MISMATCH',
        severity: 'HIGH',
        metadata: {
          provider,
          providerReference: verified.providerReference,
          reason: 'Webhook deposit reference not found.',
        },
      });

      throw new NotFoundException('Deposit not found for provider reference.');
    }

    if (
      verified.amount !== undefined &&
      (verified.amount !== deposit.amount ||
        (verified.currency ?? deposit.currency) !== deposit.currency)
    ) {
      await this.fraudService.createRiskEvent({
        userId: deposit.userId,
        type: 'DEPOSIT_WEBHOOK_MISMATCH',
        severity: 'HIGH',
        metadata: {
          provider,
          providerReference: verified.providerReference,
          expectedAmount: deposit.amount.toString(),
          receivedAmount: verified.amount.toString(),
          expectedCurrency: deposit.currency,
          receivedCurrency: verified.currency,
        },
      });

      throw new BadRequestException('Deposit webhook amount mismatch.');
    }

    if (verified.status === 'CONFIRMED') {
      return this.confirmDepositById(
        deposit.id,
        verified.metadata as Prisma.InputJsonObject | undefined,
      );
    }

    if (
      verified.status === 'FAILED' ||
      verified.status === 'EXPIRED' ||
      verified.status === 'CANCELLED'
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
      expectedAmount: undefined,
      currency: deposit.currency,
      status: deposit.status,
      idempotencyKey: deposit.idempotencyKey,
      metadata: deposit.metadata,
      createdAt: deposit.createdAt.toISOString(),
      updatedAt: deposit.updatedAt.toISOString(),
      confirmedAt: deposit.confirmedAt?.toISOString() ?? null,
      expiresAt: null,
      receiptNo: null,
      rejectionReason: null,
      reviewReason: null,
    };
  }

  toDepositIntentSnapshot(intent: DepositIntent) {
    const expectedAmount = this.decimalToString(intent.expectedAmount);

    return {
      id: intent.id,
      userId: intent.userId,
      provider: intent.provider,
      providerReference: intent.providerRef,
      amount: decimalAmountToWholeWalletUnits(expectedAmount).toString(),
      expectedAmount,
      currency: intent.currency,
      status: intent.status,
      idempotencyKey: intent.idempotencyKey,
      metadata: null,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
      confirmedAt: intent.creditedAt?.toISOString() ?? null,
      expiresAt: intent.expiresAt.toISOString(),
      receiptNo: intent.receiptNo,
      rejectionReason: intent.rejectionReason,
      reviewReason: intent.reviewReason,
    };
  }

  private toTelebirrInstructions(intent: DepositIntent) {
    return {
      depositIntentId: intent.id,
      expectedAmount: this.decimalToString(intent.expectedAmount),
      currency: intent.currency,
      receiverName: intent.receiverName,
      receiverAccount: intent.receiverAccount,
      receiverShortCode: intent.receiverShortCode,
      expiresAt: intent.expiresAt.toISOString(),
    };
  }

  private async findDepositIntentForUser(
    userId: string,
    depositIntentId: string,
  ) {
    const intent = await this.prisma.depositIntent.findUnique({
      where: { id: depositIntentId },
    });

    if (!intent || intent.userId !== userId) {
      throw new NotFoundException('Deposit not found.');
    }

    return intent;
  }

  private async assertVerificationAttemptAllowed(
    userId: string,
    intent: DepositIntent,
    receiptNo: string,
  ) {
    if (intent.status === DepositStatus.CREDITED) {
      return;
    }

    if (
      intent.status !== DepositStatus.PENDING &&
      intent.status !== DepositStatus.NEEDS_MANUAL_REVIEW
    ) {
      throw new BadRequestException(
        `Deposit cannot be verified from ${intent.status}.`,
      );
    }

    if (intent.expiresAt.getTime() <= Date.now()) {
      await this.prisma.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: DepositStatus.EXPIRED,
          rejectionReason:
            'Deposit intent expired before receipt verification.',
        },
      });

      throw new BadRequestException('Deposit intent has expired.');
    }

    const since = new Date(Date.now() - 15 * 60 * 1000);
    const [intentAttempts, receiptAttempts] = await Promise.all([
      this.prisma.paymentVerificationAttempt.count({
        where: {
          depositIntentId: intent.id,
          createdAt: { gte: since },
        },
      }),
      this.prisma.paymentVerificationAttempt.count({
        where: {
          normalizedRef: receiptNo,
          createdAt: { gte: since },
          depositIntent: {
            userId,
          },
        },
      }),
    ]);

    if (intentAttempts >= 5 || receiptAttempts >= 5) {
      await this.prisma.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: DepositStatus.NEEDS_MANUAL_REVIEW,
          reviewReason: 'Too many receipt verification attempts.',
        },
      });

      throw new BadRequestException(
        'Too many receipt verification attempts. Manual review is required.',
      );
    }
  }

  private evaluateTelebirrReceipt(
    intent: DepositIntent,
    receiptNo: string,
    parsed: ParsedTelebirrReceipt,
  ) {
    if (!parsed.receiptNo || parsed.receiptNo !== receiptNo) {
      return {
        status: 'REJECT' as const,
        reason: 'Official receipt number does not match submitted receipt.',
      };
    }

    if (!parsed.transactionStatus) {
      return {
        status: 'REVIEW' as const,
        reason: 'Official receipt status was missing.',
      };
    }

    if (!this.isSuccessfulTelebirrStatus(parsed.transactionStatus)) {
      return {
        status: 'REJECT' as const,
        reason: `Receipt status is ${parsed.transactionStatus}.`,
      };
    }

    const parsedAmount = parsed.settledAmount ?? parsed.totalAmountPaid;

    if (!parsedAmount) {
      return {
        status: 'REVIEW' as const,
        reason: 'Official receipt amount was missing.',
      };
    }

    if (
      normalizeDecimalString(parsedAmount) !==
      this.decimalToString(intent.expectedAmount)
    ) {
      return {
        status: 'REJECT' as const,
        reason: 'Receipt amount does not match the deposit intent.',
      };
    }

    if (!parsed.currency) {
      return {
        status: 'REVIEW' as const,
        reason: 'Official receipt currency was missing.',
      };
    }

    if (!this.isEtbCurrency(parsed.currency)) {
      return {
        status: 'REJECT' as const,
        reason: 'Receipt currency is not ETB/Birr.',
      };
    }

    const receiverDecision = this.verifyReceiver(intent, parsed);

    if (receiverDecision) {
      return receiverDecision;
    }

    if (!parsed.paidAt) {
      return {
        status: 'REVIEW' as const,
        reason: 'Official receipt payment timestamp was missing.',
      };
    }

    const earliestAllowed = intent.createdAt.getTime() - 10 * 60 * 1000;

    if (
      parsed.paidAt.getTime() < earliestAllowed ||
      parsed.paidAt.getTime() > intent.expiresAt.getTime()
    ) {
      return {
        status: 'REJECT' as const,
        reason: 'Receipt timestamp is outside the deposit intent window.',
      };
    }

    return {
      status: 'ACCEPT' as const,
      reason: 'Receipt verified.',
    };
  }

  private verifyReceiver(intent: DepositIntent, parsed: ParsedTelebirrReceipt) {
    if (intent.receiverName) {
      if (!parsed.creditedPartyName) {
        return {
          status: 'REVIEW' as const,
          reason: 'Official receipt receiver name was missing.',
        };
      }

      if (
        !this.normalizedIdentity(parsed.creditedPartyName).includes(
          this.normalizedIdentity(intent.receiverName),
        ) &&
        !this.normalizedIdentity(intent.receiverName).includes(
          this.normalizedIdentity(parsed.creditedPartyName),
        )
      ) {
        return {
          status: 'REJECT' as const,
          reason: 'Receipt receiver name does not match configured merchant.',
        };
      }
    }

    if (intent.receiverAccount) {
      if (!parsed.creditedPartyAccount) {
        return {
          status: 'REVIEW' as const,
          reason: 'Official receipt receiver account was missing.',
        };
      }

      const parsedAccount = this.normalizedAccount(parsed.creditedPartyAccount);
      const expectedAccount = this.normalizedAccount(intent.receiverAccount);

      if (!parsedAccount.includes(expectedAccount)) {
        return {
          status: 'REJECT' as const,
          reason:
            'Receipt receiver account does not match configured merchant.',
        };
      }
    }

    if (intent.receiverShortCode && parsed.creditedPartyAccount) {
      const parsedAccount = this.normalizedAccount(parsed.creditedPartyAccount);
      const expectedShortCode = this.normalizedAccount(
        intent.receiverShortCode,
      );

      if (!parsedAccount.includes(expectedShortCode)) {
        return {
          status: 'REJECT' as const,
          reason: 'Receipt short code does not match configured merchant.',
        };
      }
    }

    return null;
  }

  private async markIntentForReview(depositIntentId: string, reason: string) {
    return this.prisma.depositIntent.update({
      where: { id: depositIntentId },
      data: {
        status: DepositStatus.NEEDS_MANUAL_REVIEW,
        reviewReason: reason,
      },
    });
  }

  private async creditTelebirrDepositIntent(args: {
    depositIntentId: string;
    receiptNo: string;
    rawProviderHash: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${args.depositIntentId})::bigint)
      `;

      const intent = await tx.depositIntent.findUnique({
        where: { id: args.depositIntentId },
      });

      if (!intent) {
        throw new NotFoundException('Deposit not found.');
      }

      const amount = decimalAmountToWholeWalletUnits(
        this.decimalToString(intent.expectedAmount),
      );
      const idempotencyKey = `deposit:telebirr-receipt:${args.receiptNo}`;

      if (intent.status === DepositStatus.CREDITED) {
        const credit = await this.walletsService.creditDepositInTransaction(
          tx,
          {
            userId: intent.userId,
            depositId: intent.id,
            amount,
            currency: intent.currency,
            provider: PaymentProvider.TELEBIRR_RECEIPT,
            idempotencyKey,
          },
        );

        return {
          depositIntent: intent,
          wallet: credit.wallet,
          transaction: credit.transaction,
          reused: true,
        };
      }

      if (intent.status !== DepositStatus.VERIFYING) {
        throw new BadRequestException(
          `Deposit cannot be credited from ${intent.status}.`,
        );
      }

      const credit = await this.walletsService.creditDepositInTransaction(tx, {
        userId: intent.userId,
        depositId: intent.id,
        amount,
        currency: intent.currency,
        provider: PaymentProvider.TELEBIRR_RECEIPT,
        idempotencyKey,
      });

      const ledgerEntryId = credit.transaction.entries[0]?.id ?? null;
      const credited = await tx.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: DepositStatus.CREDITED,
          providerRef: args.receiptNo,
          receiptNo: args.receiptNo,
          rawProviderHash: args.rawProviderHash,
          verifiedAt: new Date(),
          creditedAt: new Date(),
          creditedWalletEntryId: ledgerEntryId,
        },
      });

      return {
        depositIntent: credited,
        wallet: credit.wallet,
        transaction: credit.transaction,
        reused: credit.reused,
      };
    }, this.transactionOptions);
  }

  private async recordTelebirrAttempt(args: {
    intent: DepositIntent;
    submittedValue: string;
    receiptNo: string;
    status: VerificationAttemptStatus;
    reason: string;
    verification?: Awaited<
      ReturnType<TelebirrReceiptProvider['fetchAndParseReceipt']>
    >;
  }) {
    await this.prisma.paymentVerificationAttempt.create({
      data: {
        depositIntentId: args.intent.id,
        provider: PaymentProvider.TELEBIRR_RECEIPT,
        submittedValue: args.submittedValue.slice(0, 4000),
        normalizedRef: args.receiptNo,
        status: args.status,
        reason: args.reason,
        httpStatus: args.verification?.httpStatus,
        providerStatus: args.verification?.providerStatus,
        parsedAmount: args.verification?.parsed.settledAmount
          ? new Prisma.Decimal(args.verification.parsed.settledAmount)
          : undefined,
        parsedCurrency: args.verification?.parsed.currency ?? undefined,
        parsedReceiver:
          args.verification?.parsed.creditedPartyName ?? undefined,
        parsedPayer: args.verification?.parsed.payerName ?? undefined,
        parsedPaidAt: args.verification?.parsed.paidAt ?? undefined,
        rawProviderHash: args.verification?.rawProviderHash,
      },
    });
  }

  private isSuccessfulTelebirrStatus(status: string) {
    return /^(completed|success|successful|paid)$/i.test(status.trim());
  }

  private isEtbCurrency(currency: string) {
    return /^(ETB|BIRR|ብር)$/i.test(currency.trim());
  }

  private normalizedIdentity(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private normalizedAccount(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private decimalToString(value: Prisma.Decimal | unknown) {
    return normalizeDecimalString(
      typeof value === 'object' && value && 'toString' in value
        ? String(value)
        : String(value),
    );
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
        'Idempotency key was already used for a different deposit request.',
      );
    }
  }

  private mergeMetadata(
    existing: Prisma.JsonValue | null,
    next: Prisma.InputJsonValue,
  ) {
    return {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing
        : {}),
      ...(next && typeof next === 'object' && !Array.isArray(next) ? next : {}),
    };
  }
}
