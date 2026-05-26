import { BadRequestException, Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { RoundStatus } from "@kingspin/db";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

type JoinRoomPayload = {
  roomId?: unknown;
};

@WebSocketGateway({
  namespace: "/game",
  cors: {
    origin: true,
    credentials: true,
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: true,
  },
})
export class RoomGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RoomGateway.name);

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage("room:join")
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    const roomId = this.parseRoomId(payload?.roomId);

    await this.assertRoomExists(roomId);
    await client.join(roomId);

    const snapshot = await this.getRoomStateSnapshot(roomId);

    client.emit("round:state", {
      roomId,
      reason: "JOINED_ROOM",
      snapshot,
      emittedAt: new Date().toISOString(),
    });

    client.to(roomId).emit("room:player-joined", {
      roomId,
      socketId: client.id,
      joinedAt: new Date().toISOString(),
    });

    return {
      ok: true,
      roomId,
      joinedAt: new Date().toISOString(),
    };
  }

  @SubscribeMessage("room:leave")
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    const roomId = this.parseRoomId(payload?.roomId);

    await client.leave(roomId);

    client.to(roomId).emit("room:player-left", {
      roomId,
      socketId: client.id,
      leftAt: new Date().toISOString(),
    });

    return {
      ok: true,
      roomId,
      leftAt: new Date().toISOString(),
    };
  }

  async broadcastRoundState(roomId: string, reason: string) {
    const snapshot = await this.getRoomStateSnapshot(roomId);

    this.server.to(roomId).emit("round:state", {
      roomId,
      reason,
      snapshot,
      emittedAt: new Date().toISOString(),
    });
  }

  async broadcastMachineResult(roomId: string, result: unknown) {
    const payload = this.toSocketSafePayload(result);

    await this.broadcastRoundState(roomId, "MACHINE_ADVANCED");

    const action =
      payload && typeof payload === "object" && "action" in payload
        ? String((payload as { action?: unknown }).action)
        : "UNKNOWN";

    if (action === "STARTED_OPEN_ROUND") {
      this.server.to(roomId).emit("round:updated", {
        roomId,
        action,
        result: payload,
        emittedAt: new Date().toISOString(),
      });
      return;
    }

    if (action === "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT") {
      this.server.to(roomId).emit("round:updated", {
        roomId,
        action,
        result: payload,
        emittedAt: new Date().toISOString(),
      });
      return;
    }

    if (action === "LOCKED_ROUND") {
      this.server.to(roomId).emit("round:locked", {
        roomId,
        action,
        result: payload,
        emittedAt: new Date().toISOString(),
      });
      return;
    }

    if (action === "DREW_ROUND") {
      this.server.to(roomId).emit("round:spinning", {
        roomId,
        action,
        result: payload,
        emittedAt: new Date().toISOString(),
      });
      return;
    }

    if (action === "SETTLED_ROUND" || action === "RESUMED_SETTLEMENT") {
      this.server.to(roomId).emit("round:settled", {
        roomId,
        action,
        result: payload,
        emittedAt: new Date().toISOString(),
      });
      return;
    }

    this.server.to(roomId).emit("round:updated", {
      roomId,
      action,
      result: payload,
      emittedAt: new Date().toISOString(),
    });
  }

  private parseRoomId(rawRoomId: unknown) {
    if (typeof rawRoomId !== "string" || rawRoomId.trim().length === 0) {
      throw new BadRequestException("roomId is required.");
    }

    return rawRoomId.trim();
  }

  private async assertRoomExists(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true },
    });

    if (!room) {
      throw new BadRequestException("Room not found.");
    }
  }

  private async getRoomStateSnapshot(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { category: true },
    });

    if (!room) {
      throw new BadRequestException("Room not found.");
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: ACTIVE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: "desc" },
    });

    const entries = currentRound
      ? await this.prisma.entry.findMany({
          where: { roundId: currentRound.id },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
              },
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : [];

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
      currentRound: currentRound ? this.toRoundSnapshot(currentRound) : null,
      entries: entries.map((entry) => ({
        id: entry.id,
        roundId: entry.roundId,
        userId: entry.userId,
        player: entry.user,
        amount: entry.amount.toString(),
        ticketStart: entry.ticketStart?.toString() ?? null,
        ticketEnd: entry.ticketEnd?.toString() ?? null,
        isWinner: entry.isWinner,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
    };
  }

  private toRoundSnapshot(round: {
    id: string;
    roomId: string;
    roundNumber: number;
    status: RoundStatus;
    totalEntryAmount: bigint;
    houseFeeAmount: bigint;
    payoutAmount: bigint;
    openedAt: Date;
    locksAt: Date | null;
    lockedAt: Date | null;
    drawingAt: Date | null;
    spinningAt: Date | null;
    settlingAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    serverSeedHash: string | null;
    winningTicket: bigint | null;
    winnerUserId: string | null;
    winnerEntryId: string | null;
    spinAngle: number | null;
  }) {
    return {
      id: round.id,
      roomId: round.roomId,
      roundNumber: round.roundNumber,
      status: round.status,
      totalEntryAmount: round.totalEntryAmount.toString(),
      houseFeeAmount: round.houseFeeAmount.toString(),
      payoutAmount: round.payoutAmount.toString(),
      openedAt: round.openedAt.toISOString(),
      locksAt: round.locksAt?.toISOString() ?? null,
      lockedAt: round.lockedAt?.toISOString() ?? null,
      drawingAt: round.drawingAt?.toISOString() ?? null,
      spinningAt: round.spinningAt?.toISOString() ?? null,
      settlingAt: round.settlingAt?.toISOString() ?? null,
      completedAt: round.completedAt?.toISOString() ?? null,
      cancelledAt: round.cancelledAt?.toISOString() ?? null,
      serverSeedHash: round.serverSeedHash,
      winningTicket: round.winningTicket?.toString() ?? null,
      winnerUserId: round.winnerUserId,
      winnerEntryId: round.winnerEntryId,
      spinAngle: round.spinAngle,
    };
  }

  private toSocketSafePayload(payload: unknown) {
    return JSON.parse(
      JSON.stringify(payload, (_key, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }

        if (value instanceof Date) {
          return value.toISOString();
        }

        return value;
      }),
    );
  }
}
