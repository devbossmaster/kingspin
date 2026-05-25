import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CreateRoomSchema } from "@kingspin/contracts";
import { PrismaService } from "../../../prisma/prisma.service";

type RoomNextStatus = "ACTIVE" | "PAUSED" | "CLOSED" | "ARCHIVED";

@Injectable()
export class AdminRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRoom(body: unknown) {
    const input = CreateRoomSchema.parse(body);

    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
    });

    if (!category) {
      throw new NotFoundException("Category not found.");
    }

    return this.prisma.room.create({
      data: {
        categoryId: input.categoryId,
        code: input.code.trim().toUpperCase(),
        name: input.name,
        status: "DRAFT",
        isPermanent: false,
        maxPlayers: input.maxPlayers,
        roundDurationMs: input.roundDurationMs,
      },
    });
  }

  async activateRoom(id: string) {
    const room = await this.findRoomOrThrow(id);

    return this.prisma.room.update({
      where: { id: room.id },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        pausedAt: null,
        closedAt: null,
        archivedAt: null,
      },
    });
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

  private async changeRoomStatus(id: string, nextStatus: RoomNextStatus) {
    const room = await this.findRoomOrThrow(id);

    if (room.isPermanent && nextStatus !== "ACTIVE") {
      throw new BadRequestException(
        "Permanent baseline rooms cannot be paused, closed, or archived.",
      );
    }

    const now = new Date();

    return this.prisma.room.update({
      where: { id: room.id },
      data: {
        status: nextStatus,
        pausedAt: nextStatus === "PAUSED" ? now : room.pausedAt,
        closedAt: nextStatus === "CLOSED" ? now : room.closedAt,
        archivedAt: nextStatus === "ARCHIVED" ? now : room.archivedAt,
      },
    });
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
}
