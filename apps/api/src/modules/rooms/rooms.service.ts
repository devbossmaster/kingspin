import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoundStatus } from '@kingspin/db';
import { PrismaService } from '../../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
  ) {}

  async findActiveByCategorySlug(categorySlug: string) {
    if (!categorySlug) {
      throw new BadRequestException('categorySlug is required.');
    }

    const rooms = await this.prisma.room.findMany({
      where: {
        category: {
          slug: categorySlug,
          isActive: true,
        },
        status: 'ACTIVE',
      },
      orderBy: [{ isPermanent: 'desc' }, { code: 'asc' }],
      select: {
        id: true,
        categoryId: true,
        code: true,
        name: true,
        status: true,
        gameMode: true,
        fixedEntryAmount: true,
        isPermanent: true,
        maxPlayers: true,
        roundDurationMs: true,
        activatedAt: true,
        rounds: {
          where: { status: { in: ACTIVE_ROUND_STATUSES } },
          orderBy: { roundNumber: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            totalEntryAmount: true,
            payoutAmount: true,
            _count: { select: { entries: true } },
          },
        },
      },
    });

    const roomSnapshots = await Promise.all(
      rooms.map(async (room) => {
        const activeRound = room.rounds[0] ?? null;
        const liveEntryAggregate = activeRound
          ? await this.prisma.entry.aggregate({
              where: { roundId: activeRound.id },
              _sum: { amount: true },
            })
          : null;
        const liveEntryAmount = liveEntryAggregate?._sum.amount ?? 0n;

        return {
          id: room.id,
          categoryId: room.categoryId,
          code: room.code,
          name: room.name,
          status: room.status,
          gameMode: room.gameMode,
          fixedEntryAmount: room.fixedEntryAmount?.toString() ?? null,
          isPermanent: room.isPermanent,
          maxPlayers: room.maxPlayers,
          roundDurationMs: room.roundDurationMs,
          activatedAt: room.activatedAt?.toISOString() ?? null,
          currentRound: activeRound
            ? {
                id: activeRound.id,
                status: activeRound.status,
                playerCount: activeRound._count.entries,
                totalEntryAmount:
                  activeRound.status === RoundStatus.OPEN
                    ? liveEntryAmount.toString()
                    : activeRound.totalEntryAmount.toString(),
                payoutAmount:
                  activeRound.status === RoundStatus.OPEN
                    ? liveEntryAmount.toString()
                    : activeRound.payoutAmount.toString(),
              }
            : null,
        };
      }),
    );

    return roomSnapshots;
  }

  async getRoomState(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { category: true },
    });

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

    const currentRound = await this.roundsService.findCurrentRoundForRoom(
      room.id,
    );

    return {
      room: {
        id: room.id,
        categoryId: room.categoryId,
        code: room.code,
        name: room.name,
        status: room.status,
        gameMode: room.gameMode,
        fixedEntryAmount: room.fixedEntryAmount?.toString() ?? null,
        isPermanent: room.isPermanent,
        maxPlayers: room.maxPlayers,
        roundDurationMs: room.roundDurationMs,
        activatedAt: room.activatedAt?.toISOString() ?? null,
      },
      category: {
        id: room.category.id,
        name: room.category.name,
        slug: room.category.slug,
        minEntryAmount: room.category.minEntryAmount.toString(),
        maxEntryAmount: room.category.maxEntryAmount.toString(),
        maxPlayers: room.category.maxPlayers,
        roundDurationMs: room.category.roundDurationMs,
      },
      currentRound,
    };
  }
}
