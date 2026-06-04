import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuditAction } from '@kingspin/db';
import { getApiEnv } from '../../../config/api-env';
import { AdminDevGuard } from '../../../guards/admin-dev.guard';
import { AuditService } from '../../audit/audit.service';
import { WalletsService } from '../../wallets/wallets.service';

type DevWalletRequestBody = {
  userId?: unknown;
  playerKey?: unknown;
  amount?: unknown;
  reason?: unknown;
  idempotencyKey?: unknown;
};

type DevWalletQuery = {
  userId?: unknown;
  playerKey?: unknown;
};

@Controller('admin/wallets')
@UseGuards(AdminDevGuard)
export class AdminWalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly auditService: AuditService,
  ) {}

  @Post('dev-credit')
  async devCredit(@Body() body: DevWalletRequestBody) {
    const amount = this.assertDevCreditAmountWithinCap(body?.amount);
    const reason = this.getReason(body?.reason);
    const creditedAt = new Date().toISOString();
    const result = await this.walletsService.devCreditMainWallet(body);

    await this.auditService.recordAdminAction({
      actorId: null,
      action: AdminAuditAction.ADMIN_CREDIT,
      targetType: 'USER',
      targetId: result.player.id,
      after: {
        wallet: result.wallet,
        transactionId: result.transaction.id,
        reused: result.reused,
      },
      metadata: {
        actor: 'ADMIN_DEV_KEY_LOCAL',
        source: 'admin/wallets/dev-credit',
        targetUserId: result.player.id,
        amount,
        reason,
        creditedAt,
        idempotencyKey: result.transaction.idempotencyKey,
      },
    });

    return result;
  }

  @Get('dev-balance')
  devBalance(@Query() query: DevWalletQuery) {
    return this.walletsService.getDevMainWalletBalance(query);
  }

  @Get('users/:userId')
  getUserMainWallet(@Param('userId') userId: string) {
    return this.walletsService.getMainWalletByUserId(userId);
  }

  private assertDevCreditAmountWithinCap(rawAmount: unknown) {
    if (typeof rawAmount !== 'number') {
      throw new BadRequestException('amount must be a number.');
    }

    if (!Number.isSafeInteger(rawAmount)) {
      throw new BadRequestException('amount must be a safe integer.');
    }

    if (rawAmount <= 0) {
      throw new BadRequestException('amount must be greater than zero.');
    }

    const maxAmount = getApiEnv().ADMIN_DEV_CREDIT_MAX;

    if (rawAmount > maxAmount) {
      throw new BadRequestException(
        `amount exceeds ADMIN_DEV_CREDIT_MAX (${maxAmount}).`,
      );
    }

    return rawAmount;
  }

  private getReason(rawReason: unknown) {
    return typeof rawReason === 'string' && rawReason.trim().length > 0
      ? rawReason.trim()
      : 'Dev admin credit';
  }
}
