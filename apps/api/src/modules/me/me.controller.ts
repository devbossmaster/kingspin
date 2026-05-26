import {
  Controller,
  Get,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth-bridge/auth.guard";
import { CurrentUser } from "../auth-bridge/current-user.decorator";
import type { AuthBridgeUser } from "../auth-bridge/auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { WalletsService } from "../wallets/wallets.service";

@Controller("me")
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
  ) {}

  @Get()
  async me(@CurrentUser() currentUser: AuthBridgeUser) {
    const user = await this.getCurrentUser(currentUser.id);

    return this.toCurrentUserSnapshot(user);
  }

  @Get("wallet")
  async wallet(@CurrentUser() currentUser: AuthBridgeUser) {
    const user = await this.getCurrentUser(currentUser.id);
    const wallet = await this.walletsService.ensureMainWalletForUserId(user.id);

    return {
      user: this.toCurrentUserSnapshot(user),
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        type: wallet.type,
        balanceSnapshot: wallet.balanceSnapshot.toString(),
        createdAt: wallet.createdAt.toISOString(),
        updatedAt: wallet.updatedAt.toISOString(),
      },
    };
  }

  private async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        emailVerified: true,
      },
    });

    if (!user) {
      throw new NotFoundException("Current user not found.");
    }

    return user;
  }

  private toCurrentUserSnapshot(user: {
    id: string;
    username: string;
    email: string;
    fullName: string;
    role: string;
    emailVerified: boolean;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      emailVerified: user.emailVerified,
    };
  }
}
