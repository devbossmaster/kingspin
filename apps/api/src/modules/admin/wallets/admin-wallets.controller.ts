import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { WalletsService } from "../../wallets/wallets.service";

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

@Controller("admin/wallets")
@UseGuards(AdminDevGuard)
export class AdminWalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post("dev-credit")
  devCredit(@Body() body: DevWalletRequestBody) {
    return this.walletsService.devCreditMainWallet(body);
  }

  @Get("dev-balance")
  devBalance(@Query() query: DevWalletQuery) {
    return this.walletsService.getDevMainWalletBalance(query);
  }

  @Get("users/:userId")
  getUserMainWallet(@Param("userId") userId: string) {
    return this.walletsService.getMainWalletByUserId(userId);
  }
}
