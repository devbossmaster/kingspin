import { BadRequestException } from '@nestjs/common';
import { DepositStatus, PaymentProvider, WithdrawalStatus } from '@kingspin/db';
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
