import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateRoomSchema } from "@kingspin/contracts";
import { GameMode, Prisma, RoomStatus } from "@kingspin/db";
import { PrismaService } from "../../../prisma/prisma.service";

type RoomNextStatus = "ACTIVE" | "PAUSED" | "CLOSED" | "ARCHIVED";

@Injectable()
export class AdminRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRooms(query: {
    page?: string;
    pageSize?: string;
    q?: string;
    status?: string;
  } = {}) {
    const parsedPage = Number(query.page ?? 1);
    const parsedPageSize = Number(query.pageSize ?? 25);
    const page =
      Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize =
      Number.isSafeInteger(parsedPageSize) && parsedPageSize > 0
        ? Math.min(parsedPageSize, 100)
        : 25;
    const search = query.q?.trim();
    const normalizedStatus = query.status?.trim().toUpperCase();
    const status = Object.values(RoomStatus).includes(
      normalizedStatus as RoomStatus,
    )
      ? (normalizedStatus as RoomStatus)
      : undefined;
    const where: Prisma.RoomWhereInput = {
      status,
      ...(search
        ? {
            OR: [
              { id: search },
              { code: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              {
                category: {
                  name: { contains: search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rooms] = await Promise.all([
      this.prisma.room.count({ where }),
      this.prisma.room.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ status: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          gameMode: true,
          isPermanent: true,
          maxPlayers: true,
          roundDurationMs: true,
          updatedAt: true,
          activatedAt: true,
          pausedAt: true,
          category: { select: { name: true, slug: true } },
          rounds: {
            take: 1,
            orderBy: { roundNumber: "desc" },
            select: {
              id: true,
              roundNumber: true,
              status: true,
              totalEntryAmount: true,
              locksAt: true,
              updatedAt: true,
              _count: { select: { entries: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: rooms.map((room) => {
        const currentRound = room.rounds[0] ?? null;
        return {
          id: room.id,
          code: room.code,
          name: room.name,
          category: room.category,
          status: room.status,
          gameMode: room.gameMode,
          isPermanent: room.isPermanent,
          maxPlayers: room.maxPlayers,
          roundDurationMs: room.roundDurationMs,
          currentRound: currentRound
            ? {
                id: currentRound.id,
                roundNumber: currentRound.roundNumber,
                status: currentRound.status,
                playersCount: currentRound._count.entries,
                poolAmount: currentRound.totalEntryAmount.toString(),
                locksAt: currentRound.locksAt?.toISOString() ?? null,
                updatedAt: currentRound.updatedAt.toISOString(),
              }
            : null,
          lastActivityAt: (
            currentRound?.updatedAt ?? room.updatedAt
          ).toISOString(),
          activatedAt: room.activatedAt?.toISOString() ?? null,
          pausedAt: room.pausedAt?.toISOString() ?? null,
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async createRoom(body: unknown) {
    const input = CreateRoomSchema.parse(body);

    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
    });

    if (!category) {
      throw new NotFoundException("Category not found.");
    }

    const room = await this.prisma.room.create({
      data: {
        categoryId: input.categoryId,
        code: input.code.trim().toUpperCase(),
        name: input.name,
        gameMode: input.gameMode ?? GameMode.FLEXIBLE_PROPORTIONAL,
        fixedEntryAmount: input.fixedEntryAmount
          ? BigInt(input.fixedEntryAmount)
          : null,
        status: "DRAFT",
        isPermanent: false,
        maxPlayers: input.maxPlayers,
        roundDurationMs: input.roundDurationMs,
      },
    });

    return this.toRoomAdminSnapshot(room);
  }

  async activateRoom(id: string) {
    const room = await this.findRoomOrThrow(id);

    const updated = await this.prisma.room.update({
      where: { id: room.id },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        pausedAt: null,
        closedAt: null,
        archivedAt: null,
      },
    });

    return this.toRoomAdminSnapshot(updated);
  }

  async pauseRoom(id: string) {
    return this.changeRoomStatus(id, "PAUSED");
  }

  async closeRoom(id: string) {
    return this.changeRoomStatus(id, "CLOSED");
  }

  async archiveRoom(id: string) {
    return this.changeRoomStatus(id, "ARCHIVED");
  }

  async configureRoom(id: string, body: unknown) {
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const data: Prisma.RoomUpdateInput = {};

    if (typeof input.name === "string") {
      data.name = input.name.trim() || null;
    }

    if (typeof input.maxPlayers === "number" && Number.isSafeInteger(input.maxPlayers) && input.maxPlayers > 0) {
      data.maxPlayers = input.maxPlayers;
    }

    if (typeof input.roundDurationMs === "number" && Number.isSafeInteger(input.roundDurationMs) && input.roundDurationMs > 0) {
      data.roundDurationMs = input.roundDurationMs;
    }

    if (
      input.gameMode === GameMode.FLEXIBLE_PROPORTIONAL ||
      input.gameMode === GameMode.FIXED_EQUAL_CHANCE
    ) {
      data.gameMode = input.gameMode;
    }

    if (typeof input.fixedEntryAmount === "number" && Number.isSafeInteger(input.fixedEntryAmount) && input.fixedEntryAmount > 0) {
      data.fixedEntryAmount = BigInt(input.fixedEntryAmount);
    }

    if (data.gameMode === GameMode.FIXED_EQUAL_CHANCE && data.fixedEntryAmount === undefined) {
      const existing = await this.findRoomOrThrow(id);

      if (!existing.fixedEntryAmount) {
        throw new BadRequestException(
          "fixedEntryAmount is required for FIXED_EQUAL_CHANCE rooms.",
        );
      }
    }

    const updated = await this.prisma.room.update({
      where: { id },
      data,
    });

    return this.toRoomAdminSnapshot(updated);
  }

  private async changeRoomStatus(id: string, nextStatus: RoomNextStatus) {
    const room = await this.findRoomOrThrow(id);

    if (room.isPermanent && nextStatus !== "ACTIVE") {
      throw new BadRequestException(
        "Permanent baseline rooms cannot be paused, closed, or archived.",
      );
    }

    const now = new Date();

    const updated = await this.prisma.room.update({
      where: { id: room.id },
      data: {
        status: nextStatus,
        pausedAt: nextStatus === "PAUSED" ? now : room.pausedAt,
        closedAt: nextStatus === "CLOSED" ? now : room.closedAt,
        archivedAt: nextStatus === "ARCHIVED" ? now : room.archivedAt,
      },
    });

    return this.toRoomAdminSnapshot(updated);
  }

  private async findRoomOrThrow(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException("Room not found.");
    }

    return room;
  }

  private toRoomAdminSnapshot(room: {
    id: string;
    categoryId: string;
    code: string;
    name: string | null;
    status: string;
    gameMode: string;
    fixedEntryAmount: bigint | null;
    isPermanent: boolean;
    maxPlayers: number;
    roundDurationMs: number;
    createdByAdminId: string | null;
    activatedAt: Date | null;
    pausedAt: Date | null;
    closedAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...room,
      fixedEntryAmount: room.fixedEntryAmount?.toString() ?? null,
      activatedAt: room.activatedAt?.toISOString() ?? null,
      pausedAt: room.pausedAt?.toISOString() ?? null,
      closedAt: room.closedAt?.toISOString() ?? null,
      archivedAt: room.archivedAt?.toISOString() ?? null,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
    };
  }
}
