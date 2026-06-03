import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth-bridge/auth.guard';
import { CurrentUser } from '../auth-bridge/current-user.decorator';
import type { AuthBridgeUser } from '../auth-bridge/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

const UpdateCurrentUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+251[1-9]\d{8}$/, 'Enter a valid Ethiopian phone number.')
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required.',
  });

@Controller('me')
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

  @Patch()
  async updateMe(
    @CurrentUser() currentUser: AuthBridgeUser,
    @Body() body: unknown,
  ) {
    const parsed = UpdateCurrentUserSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid profile update.',
      );
    }

    const user = await this.prisma.user
      .update({
        where: { id: currentUser.id },
        data: parsed.data,
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          emailVerified: true,
        },
      })
      .catch((caught: unknown) => {
        if (
          caught &&
          typeof caught === 'object' &&
          'code' in caught &&
          caught.code === 'P2002'
        ) {
          throw new BadRequestException('Phone number is already in use.');
        }

        throw caught;
      });

    return this.toCurrentUserSnapshot(user);
  }

  @Get('wallet')
  async wallet(@CurrentUser() currentUser: AuthBridgeUser) {
    /**
     * Performance fix:
     *
     * This endpoint is used by the frontend HUD and may be called around entry
     * placement. Do the authenticated user read and wallet read in parallel.
     *
     * walletsService.ensureMainWalletForUserId() is now read-first, so the
     * normal hot path is only a findUnique, not an upsert/write.
     */
    const [user, wallet] = await Promise.all([
      this.getCurrentUser(currentUser.id),
      this.walletsService.ensureMainWalletForUserId(currentUser.id),
    ]);

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

  @Get('transactions')
  transactions(
    @CurrentUser() currentUser: AuthBridgeUser,
    @Query('take') take?: string,
  ) {
    const parsedTake = Number(take);

    return this.walletsService.listMainWalletTransactionsForUserId(
      currentUser.id,
      Number.isFinite(parsedTake) ? parsedTake : 50,
    );
  }

  private async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        role: true,
        emailVerified: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Current user not found.');
    }

    return user;
  }

  private toCurrentUserSnapshot(user: {
    id: string;
    username: string;
    email: string;
    fullName: string;
    phoneNumber: string;
    role: string;
    emailVerified: boolean;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role,
      emailVerified: user.emailVerified,
    };
  }
}
