import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  DevPlaceEntrySchema,
  type DevPlaceEntryInput,
} from '@kingspin/contracts';
import { RoomGateway } from '../../../gateways/room.gateway';
import { AdminDevGuard } from '../../../guards/admin-dev.guard';
import { ZodValidationPipe } from '../../../pipes/zod-validation.pipe';
import { PrismaService } from '../../../prisma/prisma.service';
import { EntriesService } from '../../entries/entries.service';

@Controller('admin/rooms/:roomId/entries')
@UseGuards(AdminDevGuard)
export class AdminEntriesController {
  constructor(
    private readonly entriesService: EntriesService,
    private readonly roomGateway: RoomGateway,
    private readonly prisma: PrismaService,
  ) {}

  @Post('dev-place')
  async devPlaceEntry(
    @Param('roomId') roomId: string,
    @Body(new ZodValidationPipe(DevPlaceEntrySchema))
    body: DevPlaceEntryInput,
  ) {
    const user = await this.resolveAdminTargetUser(body);
    const result = await this.entriesService.placeEntryForUser({
      roomId,
      userId: user.id,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
    });

    await this.roomGateway.broadcastRoundState(
      roomId,
      result.reused ? 'ENTRY_REUSED' : 'ENTRY_PLACED',
    );

    return result;
  }

  private async resolveAdminTargetUser(body: DevPlaceEntryInput) {
    if (body.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: body.userId },
      });

      if (!user) {
        throw new NotFoundException('User not found.');
      }

      return user;
    }

    if (!body.playerKey) {
      throw new BadRequestException(
        'playerKey is required when userId is absent.',
      );
    }

    const safePlayerKey = body.playerKey
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .slice(0, 32);

    const email = `dev+${safePlayerKey}@kingspin.local`;
    const username = `dev_${safePlayerKey}`;
    const phoneNumber = this.buildDevPhoneNumber(safePlayerKey);

    return this.prisma.user.upsert({
      where: { email },
      update: {
        username,
        fullName: `Dev Player ${safePlayerKey}`,
        emailVerified: true,
      },
      create: {
        email,
        username,
        fullName: `Dev Player ${safePlayerKey}`,
        phoneNumber,
        emailVerified: true,
      },
    });
  }

  private buildDevPhoneNumber(value: string) {
    let hash = 0;

    for (const character of value) {
      hash = (hash * 31 + character.charCodeAt(0)) % 1_000_000_000;
    }

    return `+251${String(hash).padStart(9, '0')}`;
  }
}
