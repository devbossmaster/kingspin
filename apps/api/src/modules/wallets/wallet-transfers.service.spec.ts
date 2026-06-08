import { BadRequestException } from '@nestjs/common';
import {
  LedgerEntryDirection,
  LedgerTransactionType,
} from '@kingspin/db';
import { WalletTransfersService } from './wallet-transfers.service';

const createdAt = new Date('2026-06-08T08:00:00.000Z');
const sender = {
  id: 'user-sender',
  username: 'sender',
  displayUsername: 'Sender',
  fullName: 'Sender User',
  email: 'sender@example.com',
  phoneNumber: '+251911111111',
};
const recipient = {
  id: 'user-recipient',
  username: 'recipient',
  displayUsername: 'Recipient',
  fullName: 'Recipient User',
  email: 'recipient@example.com',
  phoneNumber: '+251922222222',
};

function buildTransaction() {
  return {
    id: 'transfer-1',
    type: LedgerTransactionType.WALLET_TRANSFER,
    referenceType: 'WALLET_TRANSFER',
    referenceId: null,
    idempotencyKey: 'transfer-key-1',
    metadata: {
      senderUserId: sender.id,
      recipientUserId: recipient.id,
      senderWalletId: 'wallet-sender',
      recipientWalletId: 'wallet-recipient',
      amount: '100',
      currency: 'ETB',
      note: 'Lunch',
    },
    createdAt,
    entries: [
      {
        walletAccountId: 'wallet-sender',
        direction: LedgerEntryDirection.DEBIT,
        amount: 100n,
      },
      {
        walletAccountId: 'wallet-recipient',
        direction: LedgerEntryDirection.CREDIT,
        amount: 100n,
      },
    ],
  };
}

function buildService(existingTransaction: ReturnType<
  typeof buildTransaction
> | null = null) {
  const tx = {
    walletAccount: {
      updateManyAndReturn: jest.fn().mockResolvedValue([
        {
          id: 'wallet-sender',
          balanceSnapshot: 900n,
        },
      ]),
      update: jest.fn().mockResolvedValue({
        id: 'wallet-recipient',
        balanceSnapshot: 100n,
      }),
    },
    ledgerTransaction: {
      create: jest.fn().mockResolvedValue(buildTransaction()),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === sender.id ? sender : recipient),
      ),
      findFirst: jest.fn().mockResolvedValue(recipient),
      findMany: jest.fn(),
    },
    ledgerTransaction: {
      findUnique: jest.fn().mockResolvedValue(existingTransaction),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const wallets = {
    ensureMainWalletForUserId: jest.fn((userId: string) =>
      Promise.resolve({
        id: userId === sender.id ? 'wallet-sender' : 'wallet-recipient',
      }),
    ),
  };
  const fraud = {
    createRiskEvent: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new WalletTransfersService(
      prisma as never,
      wallets as never,
      fraud as never,
    ),
    prisma,
    tx,
  };
}

describe('WalletTransfersService', () => {
  it('resolves a recipient without exposing full contact details', async () => {
    const { service } = buildService();

    await expect(
      service.resolveRecipient(sender.id, { recipient: 'recipient' }),
    ).resolves.toEqual({
      recipient: {
        id: recipient.id,
        username: 'Recipient',
        displayName: 'Recipient',
        maskedEmail: 're***@example.com',
        maskedPhone: '+251***222',
      },
    });
  });

  it('rejects self transfers and configured amount violations', async () => {
    const { service } = buildService();

    await expect(
      service.createTransfer(sender.id, {
        recipientId: sender.id,
        amount: 100,
        idempotencyKey: 'self-transfer',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createTransfer(sender.id, {
        recipientId: recipient.id,
        amount: 1001,
        idempotencyKey: 'large-transfer',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves funds atomically with balanced ledger entries', async () => {
    const { service, prisma, tx } = buildService();

    const result = await service.createTransfer(sender.id, {
      recipientId: recipient.id,
      amount: 100,
      note: 'Lunch',
      idempotencyKey: 'transfer-key-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.walletAccount.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'wallet-sender',
          balanceSnapshot: { gte: 100n },
        }),
        data: { balanceSnapshot: { decrement: 100n } },
      }),
    );
    expect(tx.ledgerTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: LedgerTransactionType.WALLET_TRANSFER,
          entries: {
            create: [
              expect.objectContaining({
                direction: LedgerEntryDirection.DEBIT,
                amount: 100n,
              }),
              expect.objectContaining({
                direction: LedgerEntryDirection.CREDIT,
                amount: 100n,
              }),
            ],
          },
        }),
      }),
    );
    expect(result).toMatchObject({
      direction: 'SENT',
      amount: '100',
      reused: false,
    });
  });

  it('reuses an exact idempotent transfer without moving funds again', async () => {
    const transaction = buildTransaction();
    const { service, prisma } = buildService(transaction);

    const result = await service.createTransfer(sender.id, {
      recipientId: recipient.id,
      amount: 100,
      note: 'Lunch',
      idempotencyKey: 'transfer-key-1',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.reused).toBe(true);
  });
});
