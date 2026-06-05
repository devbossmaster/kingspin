import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentProvider } from '@kingspin/db';
import { AuthGuard } from '../auth-bridge/auth.guard';
import { CurrentUser } from '../auth-bridge/current-user.decorator';
import type { AuthBridgeUser } from '../auth-bridge/auth.types';
import { DepositsService } from './deposits.service';
import { PaymentsProviderRegistry } from './payments-provider.registry';
import { WithdrawalsService } from './withdrawals.service';

@Controller('payments')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly providerRegistry: PaymentsProviderRegistry,
  ) {}

  @Get('providers')
  providers() {
    return this.providerRegistry.listProviders();
  }

  @Post('deposits')
  createDeposit(@CurrentUser() user: AuthBridgeUser, @Body() body: unknown) {
    return this.depositsService.createDeposit(user.id, body);
  }

  @Get('deposits')
  listDeposits(@CurrentUser() user: AuthBridgeUser) {
    return this.depositsService.listDeposits({ userId: user.id });
  }

  @Get('deposits/:id')
  getDepositStatus(
    @CurrentUser() user: AuthBridgeUser,
    @Param('id') id: string,
  ) {
    return this.depositsService.getDepositStatus(user.id, id);
  }

  @Post('deposits/:id/telebirr-receipt')
  submitTelebirrReceipt(
    @CurrentUser() user: AuthBridgeUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.depositsService.submitTelebirrReceipt(user.id, id, body);
  }

  @Post('withdrawals')
  requestWithdrawal(
    @CurrentUser() user: AuthBridgeUser,
    @Body() body: unknown,
  ) {
    return this.withdrawalsService.requestWithdrawal(user.id, body);
  }

  @Get('withdrawals')
  listWithdrawals(@CurrentUser() user: AuthBridgeUser) {
    return this.withdrawalsService.listWithdrawals({ userId: user.id });
  }

  @Patch('withdrawals/:id/cancel')
  cancelWithdrawal(
    @CurrentUser() user: AuthBridgeUser,
    @Param('id') id: string,
  ) {
    return this.withdrawalsService.cancelWithdrawal(id, user.id);
  }
}

@Controller('payments/webhooks/:provider')
export class PaymentWebhooksController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  @Post('deposits')
  depositWebhook(
    @Param('provider') provider: PaymentProvider,
    @Body() body: unknown,
  ) {
    return this.depositsService.handleDepositWebhook(provider, body, {});
  }

  @Post('withdrawals')
  withdrawalWebhook(
    @Param('provider') provider: PaymentProvider,
    @Body() body: unknown,
  ) {
    return this.withdrawalsService.handleWithdrawalWebhook(provider, body, {});
  }
}
