import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Controller("dev/players")
export class PublicDevWalletController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":playerKey/balance")
  async getDevPlayerBalance(@Param("playerKey") playerKey: string) {
    this.assertDevEndpointAllowed();

    const normalizedPlayerKey = this.normalizePlayerKey(playerKey);
    const username = normalizedPlayerKey.startsWith("dev_")
      ? normalizedPlayerKey
      : `dev_${normalizedPlayerKey}`;

    const player = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
      },
    });

    if (!player) {
      throw new NotFoundException("Dev player not found.");
    }

    const walletModel =
      (this.prisma as any).walletAccount ?? (this.prisma as any).wallet;

    if (!walletModel) {
      throw new BadRequestException("Wallet model is not available.");
    }

    const wallet = await walletModel.findFirst({
      where: {
        userId: player.id,
        type: "MAIN",
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      player,
      wallet: wallet
        ? {
            id: wallet.id,
            userId: wallet.userId,
            type: wallet.type,
            balanceSnapshot: wallet.balanceSnapshot.toString(),
            createdAt: wallet.createdAt.toISOString(),
            updatedAt: wallet.updatedAt.toISOString(),
          }
        : null,
    };
  }

  private normalizePlayerKey(playerKey: string) {
    const normalized = decodeURIComponent(playerKey ?? "").trim();

    if (!normalized) {
      throw new BadRequestException("playerKey is required.");
    }

    return normalized;
  }

  private assertDevEndpointAllowed() {
    const isProduction = process.env.NODE_ENV === "production";
    const explicitlyAllowed =
      process.env.ALLOW_PUBLIC_DEV_ENTRY_ENDPOINT === "true";

    if (isProduction && !explicitlyAllowed) {
      throw new BadRequestException(
        "Public dev wallet endpoint is disabled in production.",
      );
    }
  }
}
