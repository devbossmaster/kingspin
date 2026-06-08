import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LedgerEntryDirection,
  LedgerTransactionType,
  Prisma,
  RiskEventSeverity,
  RiskEventType,
  WalletAccountType,
} from '@kingspin/db';
import {
  CreateWalletTransferSchema,
  ResolveTransferRecipientSchema,
} from '@kingspin/contracts';
import { getApiEnv } from '../../config/api-env';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { WalletsService } from './wallets.service';

type TransferUser = {
  id: string;
  username: string;
  displayUsername: string | null;
  fullName: string;
  email: string;
  phoneNumber: string;
};

@Injectable()
export class WalletTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly fraudService: FraudService,
  ) {}

  async resolveRecipient(userId: string, body: unknown) {
    const parsed = ResolveTransferRecipientSchema.parse(body);
    const recipient = await this.findRecipient(parsed.recipient);

    if (!recipient) {
      throw new NotFoundException('Recipient not found.');
    }

    if (recipient.id === userId) {
      throw new BadRequestException('You cannot transfer to yourself.');
    }

    return { recipient: this.toSafeRecipient(recipient) };
  }

  async createTransfer(userId: string, body: unknown) {
    const parsed = CreateWalletTransferSchema.parse(body);
    const env = getApiEnv();

    if (
      parsed.amount < env.TRANSFER_MIN_ETB ||
      parsed.amount > env.TRANSFER_MAX_ETB
    ) {
      throw new BadRequestException(
        `Transfer amount must be between ${env.TRANSFER_MIN_ETB} and ${env.TRANSFER_MAX_ETB} ETB.`,
      );
    }

    if (parsed.recipientId === userId) {
      throw new BadRequestException('You cannot transfer to yourself.');
    }

    const [sender, recipient] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: this.userSelect(),
      }),
      this.prisma.user.findUnique({
        where: { id: parsed.recipientId },
        select: this.userSelect(),
      }),
    ]);

    if (!sender) {
      throw new NotFoundException('Sender not found.');
    }

    if (!recipient) {
      throw new NotFoundException('Recipient not found.');
    }

    const amount = BigInt(parsed.amount);
    const [senderWallet, recipientWallet] = await Promise.all([
      this.walletsService.ensureMainWalletForUserId(sender.id),
      this.walletsService.ensureMainWalletForUserId(recipient.id),
    ]);

    const existing = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
      include: { entries: true },
    });

    if (existing) {
      this.assertTransferMatches(existing, {
        senderWalletId: senderWallet.id,
        recipientWalletId: recipientWallet.id,
        senderUserId: sender.id,
        recipientUserId: recipient.id,
        amount,
      });

      return this.toTransferSnapshot({
        transaction: existing,
        currentUserId: sender.id,
        counterparty: recipient,
        reused: true,
      });
    }

    let transaction;

    try {
      transaction = await this.prisma.$transaction(async (tx) => {
        const debited = await tx.walletAccount.updateManyAndReturn({
          where: {
            id: senderWallet.id,
            userId: sender.id,
            type: WalletAccountType.MAIN,
            balanceSnapshot: { gte: amount },
          },
          data: { balanceSnapshot: { decrement: amount } },
        });
        const updatedSender = debited[0];

        if (!updatedSender) {
          throw new BadRequestException('Insufficient wallet balance.');
        }

        const updatedRecipient = await tx.walletAccount.update({
          where: { id: recipientWallet.id },
          data: { balanceSnapshot: { increment: amount } },
        });

        return tx.ledgerTransaction.create({
          data: {
            type: LedgerTransactionType.WALLET_TRANSFER,
            referenceType: 'WALLET_TRANSFER',
            idempotencyKey: parsed.idempotencyKey,
            metadata: {
              senderUserId: sender.id,
              recipientUserId: recipient.id,
              senderWalletId: updatedSender.id,
              recipientWalletId: updatedRecipient.id,
              amount: amount.toString(),
              currency: 'ETB',
              note: parsed.note ?? null,
            },
            entries: {
              create: [
                {
                  walletAccountId: updatedSender.id,
                  direction: LedgerEntryDirection.DEBIT,
                  amount,
                  balanceAfterSnapshot: updatedSender.balanceSnapshot,
                },
                {
                  walletAccountId: updatedRecipient.id,
                  direction: LedgerEntryDirection.CREDIT,
                  amount,
                  balanceAfterSnapshot: updatedRecipient.balanceSnapshot,
                },
              ],
            },
          },
          include: { entries: true },
        });
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      transaction =
        await this.prisma.ledgerTransaction.findUniqueOrThrow({
          where: { idempotencyKey: parsed.idempotencyKey },
          include: { entries: true },
        });
      this.assertTransferMatches(transaction, {
        senderWalletId: senderWallet.id,
        recipientWalletId: recipientWallet.id,
        senderUserId: sender.id,
        recipientUserId: recipient.id,
        amount,
      });
    }

    if (parsed.amount >= Math.ceil(env.TRANSFER_MAX_ETB * 0.8)) {
      void this.fraudService
        .createRiskEvent({
          userId: sender.id,
          type: RiskEventType.MANUAL_FLAG,
          severity: RiskEventSeverity.MEDIUM,
          summary: 'High-value wallet transfer requires review.',
          reason: 'Transfer amount reached the configured review threshold.',
          relatedType: 'WALLET_TRANSFER',
          relatedId: transaction.id,
          metadata: {
            amount: amount.toString(),
            threshold: Math.ceil(env.TRANSFER_MAX_ETB * 0.8),
            reviewOnly: true,
          },
        })
        .catch(() => undefined);
    }

    return this.toTransferSnapshot({
      transaction,
      currentUserId: sender.id,
      counterparty: recipient,
      reused: false,
    });
  }

  async listTransfers(userId: string, take = 50) {
    const wallet = await this.walletsService.ensureMainWalletForUserId(userId);
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: {
        type: LedgerTransactionType.WALLET_TRANSFER,
        entries: { some: { walletAccountId: wallet.id } },
      },
      include: { entries: true },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(take, 100)),
    });
    const counterpartyIds = transactions
      .map((transaction) => {
        const senderId = this.metadataString(transaction.metadata, 'senderUserId');
        const recipientId = this.metadataString(
          transaction.metadata,
          'recipientUserId',
        );
        return senderId === userId ? recipientId : senderId;
      })
      .filter((value): value is string => Boolean(value));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(counterpartyIds)] } },
      select: this.userSelect(),
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    return transactions.flatMap((transaction) => {
      const senderId = this.metadataString(transaction.metadata, 'senderUserId');
      const counterpartyId =
        senderId === userId
          ? this.metadataString(transaction.metadata, 'recipientUserId')
          : senderId;
      const counterparty = counterpartyId
        ? userById.get(counterpartyId)
        : undefined;

      return counterparty
        ? [
            this.toTransferSnapshot({
              transaction,
              currentUserId: userId,
              counterparty,
            }),
          ]
        : [];
    });
  }

  private async findRecipient(value: string) {
    const normalized = value.trim();
    const phone = this.normalizePhone(normalized);

    return this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: normalized, mode: 'insensitive' } },
          { displayUsername: { equals: normalized, mode: 'insensitive' } },
          { email: { equals: normalized, mode: 'insensitive' } },
          ...(phone ? [{ phoneNumber: phone }] : []),
        ],
      },
      select: this.userSelect(),
    });
  }

  private userSelect() {
    return {
      id: true,
      username: true,
      displayUsername: true,
      fullName: true,
      email: true,
      phoneNumber: true,
    } as const;
  }

  private normalizePhone(value: string) {
    const compact = value.replace(/[\s()-]/g, '');
    const normalized = compact.startsWith('0')
      ? `+251${compact.slice(1)}`
      : compact;

    return /^\+251[79]\d{8}$/.test(normalized) ? normalized : null;
  }

  private toSafeRecipient(user: TransferUser) {
    return {
      id: user.id,
      username: user.displayUsername ?? user.username,
      displayName: user.displayUsername ?? user.username ?? user.fullName,
      maskedEmail: this.maskEmail(user.email),
      maskedPhone: this.maskPhone(user.phoneNumber),
    };
  }

  private toTransferSnapshot(args: {
    transaction: {
      id: string;
      metadata: Prisma.JsonValue | null;
      createdAt: Date;
      entries: Array<{
        walletAccountId: string;
        direction: LedgerEntryDirection;
        amount: bigint;
      }>;
    };
    currentUserId: string;
    counterparty: TransferUser;
    reused?: boolean;
  }) {
    const senderId = this.metadataString(
      args.transaction.metadata,
      'senderUserId',
    );

    return {
      id: args.transaction.id,
      direction: senderId === args.currentUserId ? ('SENT' as const) : ('RECEIVED' as const),
      amount:
        this.metadataString(args.transaction.metadata, 'amount') ??
        args.transaction.entries[0]?.amount.toString() ??
        '0',
      currency:
        this.metadataString(args.transaction.metadata, 'currency') ?? 'ETB',
      note: this.metadataString(args.transaction.metadata, 'note'),
      counterparty: this.toSafeRecipient(args.counterparty),
      createdAt: args.transaction.createdAt.toISOString(),
      ...(typeof args.reused === 'boolean' ? { reused: args.reused } : {}),
    };
  }

  private assertTransferMatches(
    transaction: {
      type: LedgerTransactionType;
      metadata: Prisma.JsonValue | null;
      entries: Array<{
        walletAccountId: string;
        direction: LedgerEntryDirection;
        amount: bigint;
      }>;
    },
    args: {
      senderWalletId: string;
      recipientWalletId: string;
      senderUserId: string;
      recipientUserId: string;
      amount: bigint;
    },
  ) {
    const debit = transaction.entries.find(
      (entry) => entry.direction === LedgerEntryDirection.DEBIT,
    );
    const credit = transaction.entries.find(
      (entry) => entry.direction === LedgerEntryDirection.CREDIT,
    );
    const matches =
      transaction.type === LedgerTransactionType.WALLET_TRANSFER &&
      debit?.walletAccountId === args.senderWalletId &&
      debit.amount === args.amount &&
      credit?.walletAccountId === args.recipientWalletId &&
      credit.amount === args.amount &&
      this.metadataString(transaction.metadata, 'senderUserId') ===
        args.senderUserId &&
      this.metadataString(transaction.metadata, 'recipientUserId') ===
        args.recipientUserId &&
      this.metadataString(transaction.metadata, 'amount') ===
        args.amount.toString();

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different transfer.',
      );
    }
  }

  private metadataString(metadata: Prisma.JsonValue | null, key: string) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  private maskEmail(value: string) {
    const [local, domain] = value.split('@');
    return domain ? `${local.slice(0, 2)}***@${domain}` : null;
  }

  private maskPhone(value: string) {
    return value.length >= 6 ? `${value.slice(0, 4)}***${value.slice(-3)}` : null;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
