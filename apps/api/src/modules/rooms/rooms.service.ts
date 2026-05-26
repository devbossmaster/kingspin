import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RoundsService } from "../rounds/rounds.service";

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
  ) {}

  async findActiveByCategorySlug(categorySlug: string) {
    if (!categorySlug) {
      throw new BadRequestException("categorySlug is required.");
    }

    return this.prisma.room.findMany({
      where: {
        category: {
          slug: categorySlug,
          isActive: true,
        },
        status: "ACTIVE",
      },
      orderBy: [{ isPermanent: "desc" }, { code: "asc" }],
      select: {
        id: true,
        categoryId: true,
        code: true,
        name: true,
        status: true,
        isPermanent: true,
        maxPlayers: true,
        roundDurationMs: true,
        activatedAt: true,
      },
    });
  }

  async getRoomState(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { category: true },
    });

    if (!room) {
      throw new NotFoundException("Room not found.");
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
