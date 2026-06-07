import { BadRequestException } from '@nestjs/common';
import { AdminPaymentsController } from './admin-payments.controller';

describe('AdminPaymentsController', () => {
  const admin = { id: 'admin-1', role: 'FINANCE' } as never;
  const depositsService = {
    approveReviewedDeposit: jest.fn(),
    rejectDeposit: jest.fn(),
  };
  const withdrawalsService = {
    markPaid: jest.fn(),
    rejectWithdrawal: jest.fn(),
  };
  const auditService = {
    recordAdminAction: jest.fn(),
  };
  const controller = new AdminPaymentsController(
    depositsService as never,
    withdrawalsService as never,
    auditService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires an admin note before approving a reviewed deposit', async () => {
    await expect(
      controller.approveReviewedDeposit(admin, 'deposit-1', {
        adminNote: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(depositsService.approveReviewedDeposit).not.toHaveBeenCalled();
  });

  it('requires a reason before rejecting a deposit', async () => {
    await expect(
      controller.rejectDeposit(admin, 'deposit-1', { reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(depositsService.rejectDeposit).not.toHaveBeenCalled();
  });

  it('requires an external reference before completing a withdrawal', async () => {
    await expect(
      controller.completeWithdrawal(admin, 'withdrawal-1', {
        externalReference: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withdrawalsService.markPaid).not.toHaveBeenCalled();
  });

  it('requires a reason before rejecting a withdrawal', async () => {
    await expect(
      controller.rejectWithdrawal(admin, 'withdrawal-1', { reason: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withdrawalsService.rejectWithdrawal).not.toHaveBeenCalled();
  });
});
