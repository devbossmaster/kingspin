import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth-bridge/auth.guard';
import { CurrentUser } from '../auth-bridge/current-user.decorator';
import type { AuthBridgeUser } from '../auth-bridge/auth.types';
import { WalletTransfersService } from './wallet-transfers.service';

@Controller('wallet/transfers')
@UseGuards(AuthGuard)
export class WalletTransfersController {
  constructor(private readonly transfersService: WalletTransfersService) {}

  @Post('resolve-recipient')
  resolveRecipient(
    @CurrentUser() user: AuthBridgeUser,
    @Body() body: unknown,
  ) {
    return this.transfersService.resolveRecipient(user.id, body);
  }

  @Post()
  createTransfer(@CurrentUser() user: AuthBridgeUser, @Body() body: unknown) {
    return this.transfersService.createTransfer(user.id, body);
  }

  @Get()
  listTransfers(
    @CurrentUser() user: AuthBridgeUser,
    @Query('take') take?: string,
  ) {
    const parsedTake = Number(take);
    return this.transfersService.listTransfers(
      user.id,
      Number.isFinite(parsedTake) ? parsedTake : 50,
    );
  }
}
