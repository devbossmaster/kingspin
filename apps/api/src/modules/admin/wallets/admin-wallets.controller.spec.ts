import { BadRequestException } from '@nestjs/common';
import { AdminAuditAction } from '@kingspin/db';
import { resetApiEnvForTesting } from '../../../config/api-env';
import { AdminWalletsController } from './admin-wallets.controller';

describe('AdminWalletsController', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      APP_ENV: 'local',
      ADMIN_DEV_CREDIT_MAX: '10000',
    };
    resetApiEnvForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetApiEnvForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function buildController() {
    const creditResult = {
      player: {
        id: 'user-1',
        username: 'player',
        email: 'player@example.com',
        fullName: 'Player One',
      },
      wallet: {
        id: 'wallet-1',
        userId: 'user-1',
        type: 'MAIN',
        balanceSnapshot: '5000',
        createdAt: '2026-06-04T00:00:00.000Z',
        updatedAt: '2026-06-04T00:00:00.000Z',
      },
      transaction: {
        id: 'transaction-1',
        type: 'ADMIN_CREDIT',
        referenceType: 'ADMIN_DEV_CREDIT',
        referenceId: 'user-1',
        idempotencyKey: 'admin-credit-key-1',
        metadata: null,
        createdAt: '2026-06-04T00:00:00.000Z',
        entries: [],
      },
      reused: false,
    };
    const walletsService = {
      devCreditMainWallet: jest.fn().mockResolvedValue(creditResult),
      getDevMainWalletBalance: jest.fn(),
      getMainWalletByUserId: jest.fn(),
    };
    const auditService = {
      recordAdminAction: jest.fn().mockResolvedValue({
        recorded: true,
        auditLogId: 'audit-1',
        createdAt: '2026-06-04T00:00:00.000Z',
      }),
    };

    return {
      controller: new AdminWalletsController(
        walletsService as any,
        auditService as any,
      ),
      walletsService,
      auditService,
      creditResult,
    };
  }

  it('rejects dev credit amounts over ADMIN_DEV_CREDIT_MAX', async () => {
    const { controller, walletsService, auditService } = buildController();

    await expect(
      controller.devCredit({
        userId: 'user-1',
        amount: 10001,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(walletsService.devCreditMainWallet).not.toHaveBeenCalled();
    expect(auditService.recordAdminAction).not.toHaveBeenCalled();
  });

  it('credits through the wallet service and records an audit entry', async () => {
    const { controller, walletsService, auditService, creditResult } =
      buildController();
    const body = {
      userId: 'user-1',
      amount: 5000,
      reason: 'test credit',
      idempotencyKey: 'admin-credit-key-1',
    };

    await expect(controller.devCredit(body)).resolves.toEqual(creditResult);

    expect(walletsService.devCreditMainWallet).toHaveBeenCalledWith(body);
    expect(auditService.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        action: AdminAuditAction.ADMIN_CREDIT,
        targetType: 'USER',
        targetId: 'user-1',
      }),
    );
    const auditCalls = auditService.recordAdminAction.mock
      .calls as unknown as Array<[{ metadata: Record<string, unknown> }]>;
    const auditInput = auditCalls[0]?.[0];

    expect(auditInput?.metadata).toMatchObject({
      actor: 'ADMIN_DEV_KEY_LOCAL',
      targetUserId: 'user-1',
      amount: 5000,
      reason: 'test credit',
      idempotencyKey: 'admin-credit-key-1',
    });
  });
});
