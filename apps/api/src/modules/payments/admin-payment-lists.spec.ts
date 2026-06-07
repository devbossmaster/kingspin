import { PaymentProvider, WithdrawalStatus } from '@kingspin/db';
import { DepositsService } from './deposits.service';
import { WithdrawalsService } from './withdrawals.service';

describe('Admin payment list endpoints', () => {
  const deposit = {
    count: jest.fn(),
    findMany: jest.fn(),
  };
  const depositIntent = {
    count: jest.fn(),
    findMany: jest.fn(),
  };
  const withdrawal = {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const riskEvent = {
    findMany: jest.fn(),
  };
  const depositsService = new DepositsService(
    { deposit, depositIntent, riskEvent } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const withdrawalsService = new WithdrawalsService(
    { withdrawal, riskEvent } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    deposit.count.mockResolvedValue(0);
    deposit.findMany.mockResolvedValue([]);
    depositIntent.count.mockResolvedValue(0);
    depositIntent.findMany.mockResolvedValue([]);
    withdrawal.count.mockResolvedValue(0);
    withdrawal.findMany.mockResolvedValue([]);
    riskEvent.findMany.mockResolvedValue([]);
  });

  it('caps admin deposits and selects list-safe fields only', async () => {
    await depositsService.listAdminDeposits({ pageSize: '999' });

    expect(deposit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        select: expect.objectContaining({
          id: true,
          metadata: true,
          user: expect.objectContaining({
            select: expect.objectContaining({ email: true }),
          }),
        }),
      }),
    );
    expect(deposit.findMany.mock.calls[0][0].include).toBeUndefined();
    expect(depositIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        select: expect.objectContaining({
          receiptNo: true,
          reviewReason: true,
          _count: expect.objectContaining({
            select: expect.objectContaining({ attempts: true }),
          }),
        }),
      }),
    );
    expect(depositIntent.findMany.mock.calls[0][0].include).toBeUndefined();
  });

  it('caps admin withdrawals and masks withdrawal detail destinations', async () => {
    await withdrawalsService.listAdminWithdrawals({ pageSize: '999' });

    expect(withdrawal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        select: expect.objectContaining({
          destination: true,
          user: expect.objectContaining({
            select: expect.objectContaining({ email: true }),
          }),
        }),
      }),
    );
    expect(withdrawal.findMany.mock.calls[0][0].include).toBeUndefined();

    withdrawal.findUnique.mockResolvedValue({
      id: 'withdrawal-1',
      provider: PaymentProvider.MOCK,
      amount: 1000n,
      currency: 'ETB',
      status: WithdrawalStatus.PENDING_REVIEW,
      destination: {
        phoneNumber: '251912345678',
        account: '1234567890',
      },
      providerReference: null,
      requestedAt: new Date('2026-06-05T08:00:00.000Z'),
      reviewedAt: null,
      paidAt: null,
      rejectionReason: null,
      user: {
        username: 'player',
        displayUsername: null,
        email: 'player@example.com',
      },
    });

    const detail = await withdrawalsService.getAdminWithdrawal('withdrawal-1');

    expect(detail.destination).toEqual({
      phoneNumber: '2519***678',
      account: '1234***890',
    });
  });
});
