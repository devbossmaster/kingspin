import { BadRequestException } from '@nestjs/common';
import {
  DepositStatus,
  PaymentProvider,
  Prisma,
  VerificationAttemptStatus,
  WithdrawalStatus,
} from '@kingspin/db';
import { DepositsService } from './deposits.service';
import { WithdrawalsService } from './withdrawals.service';

const now = new Date('2026-05-28T12:00:00.000Z');

function buildDeposit(overrides = {}) {
  return {
    id: 'deposit-1',
    userId: 'user-1',
    provider: PaymentProvider.MANUAL,
    providerReference: 'manual-deposit-1',
    amount: 1_000n,
    currency: 'COIN',
    status: DepositStatus.PENDING,
    idempotencyKey: 'deposit-key-1',
    metadata: null,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
    ...overrides,
  };
}

function buildDepositIntent(overrides = {}) {
  return {
    id: 'intent-1',
    userId: 'user-1',
    provider: PaymentProvider.TELEBIRR_RECEIPT,
    status: DepositStatus.PENDING,
    expectedAmount: new Prisma.Decimal('500.00'),
    currency: 'ETB',
    receiverName: 'SpinPro Test Merchant',
    receiverAccount: '123456',
    receiverShortCode: null,
    providerRef: null,
    receiptNo: null,
    creditedWalletEntryId: null,
    idempotencyKey: 'intent-key-1',
    rejectionReason: null,
    reviewReason: null,
    rawProviderHash: null,
    verifiedAt: null,
    creditedAt: null,
    expiresAt: new Date('2026-05-28T12:15:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildWithdrawal(overrides = {}) {
  return {
    id: 'withdrawal-1',
    userId: 'user-1',
    walletAccountId: 'wallet-1',
    provider: PaymentProvider.MANUAL,
    amount: 500n,
    currency: 'COIN',
    destination: { account: 'masked' },
    status: WithdrawalStatus.PENDING_REVIEW,
    providerReference: null,
    requestedAt: now,
    reviewedAt: null,
    reviewedByAdminId: null,
    paidAt: null,
    rejectionReason: null,
    idempotencyKey: 'withdrawal-key-1',
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Payment money safety foundation', () => {
  it('creates a Telebirr deposit intent with payment instructions', async () => {
    const intent = buildDepositIntent();
    const prisma = {
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(intent),
      },
    };
    const telebirr = {
      getConfig: jest.fn().mockReturnValue({
        enabled: true,
        expectedReceiverName: 'SpinPro Test Merchant',
        expectedReceiverAccount: '123456',
        expectedShortCode: null,
        minDeposit: 10,
        maxDeposit: 10_000,
        intentTtlMinutes: 15,
      }),
    };
    const service = new DepositsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      telebirr as never,
    );

    const result = await service.createDeposit('user-1', {
      provider: 'TELEBIRR_RECEIPT',
      amount: '500.00',
      currency: 'ETB',
      idempotencyKey: 'intent-key-1',
    });

    expect(prisma.depositIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: PaymentProvider.TELEBIRR_RECEIPT,
          expectedAmount: expect.any(Prisma.Decimal),
          receiverName: 'SpinPro Test Merchant',
        }),
      }),
    );
    expect(result.deposit.status).toBe(DepositStatus.PENDING);
    expect(result.instructions.receiverAccount).toBe('123456');
  });

  it('rejects Telebirr deposit amounts outside configured bounds', async () => {
    const telebirr = {
      getConfig: jest.fn().mockReturnValue({
        enabled: true,
        minDeposit: 10,
        maxDeposit: 10_000,
        intentTtlMinutes: 15,
      }),
    };
    const service = new DepositsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      telebirr as never,
    );

    await expect(
      service.createDeposit('user-1', {
        provider: 'TELEBIRR_RECEIPT',
        amount: '5.00',
        currency: 'ETB',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('credits a verified Telebirr receipt through the wallet ledger once', async () => {
    const createdAt = new Date();
    const paidAt = new Date(createdAt.getTime() + 60_000);
    const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
    const pendingIntent = buildDepositIntent({
      createdAt,
      expiresAt,
    });
    const verifyingIntent = buildDepositIntent({
      status: DepositStatus.VERIFYING,
      createdAt,
      expiresAt,
    });
    const creditedIntent = buildDepositIntent({
      status: DepositStatus.CREDITED,
      receiptNo: 'ABC123XYZ',
      providerRef: 'ABC123XYZ',
      creditedAt: paidAt,
      verifiedAt: paidAt,
      createdAt,
      expiresAt,
    });
    const tx = {
      $queryRaw: jest.fn(),
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue(verifyingIntent),
        update: jest.fn().mockResolvedValue(creditedIntent),
      },
    };
    const prisma = {
      depositIntent: {
        findUnique: jest.fn().mockResolvedValue(pendingIntent),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(verifyingIntent),
      },
      paymentVerificationAttempt: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const wallets = {
      creditDepositInTransaction: jest.fn().mockResolvedValue({
        wallet: { id: 'wallet-1', balanceSnapshot: '500' },
        transaction: {
          id: 'ledger-1',
          entries: [{ id: 'ledger-entry-1' }],
        },
        reused: false,
      }),
    };
    const telebirr = {
      normalizeReceiptInput: jest.fn().mockReturnValue('ABC123XYZ'),
      fetchAndParseReceipt: jest.fn().mockResolvedValue({
        receiptNo: 'ABC123XYZ',
        httpStatus: 200,
        providerStatus: 'Completed',
        rawProviderHash: 'hash-1',
        parsed: {
          receiptNo: 'ABC123XYZ',
          transactionStatus: 'Completed',
          paidAt,
          settledAmount: '500.00',
          totalAmountPaid: '500.00',
          currency: 'ETB',
          creditedPartyName: 'SpinPro Test Merchant',
          creditedPartyAccount: '123456',
          payerName: 'Sample Player',
          payerPhoneMasked: '091***1234',
          paymentReason: 'Wallet deposit',
          paymentMode: 'Telebirr',
        },
      }),
    };
    const service = new DepositsService(
      prisma as never,
      wallets as never,
      {} as never,
      { createRiskEvent: jest.fn() } as never,
      telebirr as never,
    );

    const result = await service.submitTelebirrReceipt('user-1', 'intent-1', {
      receiptInput: 'https://transactioninfo.ethiotelecom.et/receipt/ABC123XYZ',
    });

    expect(wallets.creditDepositInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'user-1',
        depositId: 'intent-1',
        amount: 500n,
        currency: 'ETB',
        provider: PaymentProvider.TELEBIRR_RECEIPT,
        idempotencyKey: 'deposit:telebirr-receipt:ABC123XYZ',
      }),
    );
    expect(prisma.paymentVerificationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VerificationAttemptStatus.ACCEPTED,
          normalizedRef: 'ABC123XYZ',
          rawProviderHash: 'hash-1',
        }),
      }),
    );
    expect(result.deposit.status).toBe(DepositStatus.CREDITED);
  });

  it('confirms a deposit through the wallet ledger service exactly once', async () => {
    const deposit = buildDeposit();
    const updatedDeposit = buildDeposit({
      status: DepositStatus.CONFIRMED,
      confirmedAt: now,
    });
    const tx = {
      deposit: {
        findUnique: jest.fn().mockResolvedValue(deposit),
        update: jest.fn().mockResolvedValue(updatedDeposit),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const wallets = {
      creditDepositInTransaction: jest.fn().mockResolvedValue({
        wallet: { id: 'wallet-1', balanceSnapshot: '1000' },
        transaction: { id: 'ledger-1' },
        reused: false,
      }),
    };
    const service = new DepositsService(
      prisma as never,
      wallets as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.confirmDepositById('deposit-1');

    expect(tx.deposit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DepositStatus.CONFIRMED }),
      }),
    );
    expect(wallets.creditDepositInTransaction).toHaveBeenCalledTimes(1);
    expect(result.deposit.status).toBe(DepositStatus.CONFIRMED);
  });

  it('replaying an already confirmed deposit reuses the deposit credit ledger', async () => {
    const deposit = buildDeposit({
      status: DepositStatus.CONFIRMED,
      confirmedAt: now,
    });
    const tx = {
      deposit: {
        findUnique: jest.fn().mockResolvedValue(deposit),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const wallets = {
      creditDepositInTransaction: jest.fn().mockResolvedValue({
        wallet: { id: 'wallet-1', balanceSnapshot: '1000' },
        transaction: { id: 'ledger-1' },
        reused: true,
      }),
    };
    const service = new DepositsService(
      prisma as never,
      wallets as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.confirmDepositById('deposit-1');

    expect(wallets.creditDepositInTransaction).toHaveBeenCalledTimes(1);
    expect(result.reused).toBe(true);
    expect(result.deposit.status).toBe(DepositStatus.CONFIRMED);
  });

  it('rejects a withdrawal by refunding the reserved funds through the wallet ledger service', async () => {
    const withdrawal = buildWithdrawal();
    const rejected = buildWithdrawal({
      status: WithdrawalStatus.REJECTED,
      rejectionReason: 'Risk review',
      reviewedByAdminId: 'admin-1',
      reviewedAt: now,
    });
    const tx = {
      withdrawal: {
        findUnique: jest.fn().mockResolvedValue(withdrawal),
        update: jest.fn().mockResolvedValue(rejected),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const wallets = {
      refundWithdrawalInTransaction: jest.fn().mockResolvedValue({
        wallet: { id: 'wallet-1', balanceSnapshot: '1000' },
        transaction: { id: 'refund-ledger-1' },
        reused: false,
      }),
    };
    const service = new WithdrawalsService(
      prisma as never,
      wallets as never,
      {} as never,
      {} as never,
    );

    const result = await service.rejectWithdrawal(
      'withdrawal-1',
      'admin-1',
      'Risk review',
    );

    expect(wallets.refundWithdrawalInTransaction).toHaveBeenCalledTimes(1);
    expect(result.withdrawal.status).toBe(WithdrawalStatus.REJECTED);
  });

  it('does not allow approving an already paid withdrawal', async () => {
    const prisma = {
      withdrawal: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            buildWithdrawal({ status: WithdrawalStatus.PAID }),
          ),
      },
    };
    const service = new WithdrawalsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.approveWithdrawal('withdrawal-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not refund an already rejected withdrawal again', async () => {
    const rejected = buildWithdrawal({
      status: WithdrawalStatus.REJECTED,
      rejectionReason: 'Risk review',
      reviewedByAdminId: 'admin-1',
      reviewedAt: now,
    });
    const tx = {
      withdrawal: {
        findUnique: jest.fn().mockResolvedValue(rejected),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const wallets = {
      refundWithdrawalInTransaction: jest.fn(),
    };
    const service = new WithdrawalsService(
      prisma as never,
      wallets as never,
      {} as never,
      {} as never,
    );

    const result = await service.rejectWithdrawal(
      'withdrawal-1',
      'admin-1',
      'Risk review',
    );

    expect(result.reused).toBe(true);
    expect(wallets.refundWithdrawalInTransaction).not.toHaveBeenCalled();
    expect(tx.withdrawal.update).not.toHaveBeenCalled();
  });

  it('replaying mark paid does not mutate wallet state', async () => {
    const paid = buildWithdrawal({
      status: WithdrawalStatus.PAID,
      paidAt: now,
      reviewedByAdminId: 'admin-1',
      reviewedAt: now,
    });
    const prisma = {
      withdrawal: {
        findUnique: jest.fn().mockResolvedValue(paid),
        update: jest.fn(),
      },
    };
    const service = new WithdrawalsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.markPaid('withdrawal-1', 'admin-1');

    expect(result.reused).toBe(true);
    expect(prisma.withdrawal.update).not.toHaveBeenCalled();
  });
});
