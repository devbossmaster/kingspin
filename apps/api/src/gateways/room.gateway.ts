import { BadRequestException, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";
import {
  SOCKET_EVENTS,
  SocketMachineEventSchema,
  SocketPresenceEventSchema,
  SocketRoomJoinAckSchema,
  SocketRoomJoinPayloadSchema,
  SocketRoomLeaveAckSchema,
  SocketRoomLeavePayloadSchema,
  SocketRoundStateEventSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@kingspin/contracts";
import { RoundStatus } from "@kingspin/db";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { Server, Socket } from "socket.io";
import { getApiEnv } from "../config/api-env";
import { PrismaService } from "../prisma/prisma.service";

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RedisClient = ReturnType<typeof createClient>;
type RoomStateSnapshot = Awaited<ReturnType<RoomGateway["buildRoomStateSnapshot"]>>;

function allowConfiguredSocketOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) {
  const allowedOrigin = getApiEnv().API_CORS_ORIGIN;

  callback(null, !origin || origin === allowedOrigin);
}

@WebSocketGateway({
  namespace: "/game",
  cors: {
    origin: allowConfiguredSocketOrigin,
    credentials: true,
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: true,
  },
})
export class RoomGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: GameServer;

  private readonly logger = new Logger(RoomGateway.name);
  private readonly inFlightSnapshotsByRoom = new Map<
    string,
    Promise<RoomStateSnapshot>
  >();

  private redisPublisher: RedisClient | null = null;
  private redisSubscriber: RedisClient | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async afterInit(server: GameServer) {
    const env = getApiEnv();

    await this.configureRedisAdapter(server);

    // TODO(auth): validate the Better Auth session/JWT from the socket
    // handshake before allowing authenticated room actions.
    this.logger.log("Socket.IO /game namespace initialized.");

    if (env.NODE_ENV === "production" && !env.ENABLE_REDIS) {
      this.logger.warn(
        "Socket.IO Redis adapter is disabled. Production scaling requires sticky sessions or a Redis adapter.",
      );
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.redisSubscriber?.quit(),
      this.redisPublisher?.quit(),
    ]);
  }

  handleConnection(client: GameSocket) {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: GameSocket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage(SOCKET_EVENTS.ROOM_JOIN)
  async handleJoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ) {
    const parsedPayload = SocketRoomJoinPayloadSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new WsException("Invalid room:join payload.");
    }

    const roomId = this.parseRoomId(parsedPayload.data.roomId);

    await this.assertRoomExists(roomId);
    await client.join(roomId);

    const snapshot = await this.getRoomStateSnapshot(roomId);
    const emittedAt = new Date().toISOString();

    const roundState = SocketRoundStateEventSchema.parse({
      roomId,
      reason: "JOINED_ROOM",
      snapshot,
      emittedAt,
    });

    client.emit(SOCKET_EVENTS.ROUND_STATE, roundState);

    const presence = SocketPresenceEventSchema.parse({
      roomId,
      socketId: client.id,
      joinedAt: emittedAt,
    });

    client.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_JOINED, presence);

    return SocketRoomJoinAckSchema.parse({
      ok: true,
      roomId,
      joinedAt: emittedAt,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.ROOM_LEAVE)
  async handleLeave(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ) {
    const parsedPayload = SocketRoomLeavePayloadSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new WsException("Invalid room:leave payload.");
    }

    const roomId = this.parseRoomId(parsedPayload.data.roomId);

    await client.leave(roomId);

    const leftAt = new Date().toISOString();
    const presence = SocketPresenceEventSchema.parse({
      roomId,
      socketId: client.id,
      leftAt,
    });

    client.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, presence);

    return SocketRoomLeaveAckSchema.parse({
      ok: true,
      roomId,
      leftAt,
    });
  }

  async broadcastRoundState(roomId: string, reason: string) {
    const snapshot = await this.getRoomStateSnapshot(roomId);

    const payload = SocketRoundStateEventSchema.parse({
      roomId,
      reason,
      snapshot,
      emittedAt: new Date().toISOString(),
    });

    this.server.to(roomId).emit(SOCKET_EVENTS.ROUND_STATE, payload);
  }

  async broadcastMachineResult(roomId: string, result: unknown) {
    const payload = this.toSocketSafePayload(result);

    /**
     * Performance fix:
     *
     * Do not block machine-event emission on a full room snapshot rebuild.
     * The caller already runs this in the background, but this keeps the gateway
     * itself responsive and avoids serial socket work.
     */
    void this.broadcastRoundState(roomId, "MACHINE_ADVANCED").catch(
      (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown round state error";

        this.logger.warn(
          `Failed to broadcast room state for ${roomId} after machine result: ${message}`,
        );
      },
    );

    const action =
      payload && typeof payload === "object" && "action" in payload
        ? String((payload as { action?: unknown }).action)
        : "UNKNOWN";

    if (action === "STARTED_OPEN_ROUND") {
      this.emitMachineEvent(roomId, SOCKET_EVENTS.ROUND_UPDATED, action, payload);
      return;
    }

    if (action === "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT") {
      this.emitMachineEvent(roomId, SOCKET_EVENTS.ROUND_UPDATED, action, payload);
      return;
    }

    if (action === "LOCKED_ROUND") {
      this.emitMachineEvent(roomId, SOCKET_EVENTS.ROUND_LOCKED, action, payload);
      return;
    }

    if (action === "DREW_ROUND") {
      this.emitMachineEvent(roomId, SOCKET_EVENTS.ROUND_SPINNING, action, payload);
      return;
    }

    if (action === "SETTLED_ROUND" || action === "RESUMED_SETTLEMENT") {
      this.emitMachineEvent(roomId, SOCKET_EVENTS.ROUND_SETTLED, action, payload);
      return;
    }

    this.emitMachineEvent(roomId, SOCKET_EVENTS.ROUND_UPDATED, action, payload);
  }

  private emitMachineEvent(
    roomId: string,
    eventName:
      | typeof SOCKET_EVENTS.ROUND_UPDATED
      | typeof SOCKET_EVENTS.ROUND_LOCKED
      | typeof SOCKET_EVENTS.ROUND_SPINNING
      | typeof SOCKET_EVENTS.ROUND_SETTLED,
    action: string,
    result: unknown,
  ) {
    const payload = SocketMachineEventSchema.parse({
      roomId,
      action,
      result,
      emittedAt: new Date().toISOString(),
    });

    this.server.to(roomId).emit(eventName, payload);
  }

  private async configureRedisAdapter(server: GameServer) {
    const env = getApiEnv();

    if (!env.ENABLE_REDIS) {
      return;
    }

    if (!env.REDIS_URL) {
      const message = "ENABLE_REDIS=true but REDIS_URL is missing.";

      if (env.NODE_ENV === "production") {
        throw new Error(message);
      }

      this.logger.warn(message);
      return;
    }

    const publisher = createClient({ url: env.REDIS_URL });
    const subscriber = publisher.duplicate();

    publisher.on("error", (error) => {
      this.logger.error(`Socket.IO Redis publisher error: ${error.message}`);
    });

    subscriber.on("error", (error) => {
      this.logger.error(`Socket.IO Redis subscriber error: ${error.message}`);
    });

    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      server.adapter(createAdapter(publisher, subscriber));

      this.redisPublisher = publisher;
      this.redisSubscriber = subscriber;

      this.logger.log("Socket.IO Redis adapter enabled for /game namespace.");
    } catch (error) {
      await Promise.allSettled([subscriber.quit(), publisher.quit()]);

      const message =
        error instanceof Error ? error.message : "Unknown Redis adapter error";

      if (env.NODE_ENV === "production") {
        this.logger.error(`Socket.IO Redis adapter failed: ${message}`);
        throw error;
      }

      this.logger.warn(
        `Socket.IO Redis adapter failed; continuing without Redis in ${env.NODE_ENV}: ${message}`,
      );
    }
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
    /**
     * Performance fix:
     *
     * Entry placement, machine transitions, and room join can request the same
     * snapshot at the same time. Share the in-flight DB work per room instead
     * of rebuilding the same snapshot repeatedly.
     *
     * This is not stale caching. After the current snapshot resolves, the next
     * call performs fresh DB reads.
     */
    const existing = this.inFlightSnapshotsByRoom.get(roomId);

    if (existing) {
      return existing;
    }

    const request = this.buildRoomStateSnapshot(roomId).finally(() => {
      this.inFlightSnapshotsByRoom.delete(roomId);
    });

    this.inFlightSnapshotsByRoom.set(roomId, request);

    return request;
  }

  private async buildRoomStateSnapshot(roomId: string) {
    const [room, currentRound] = await Promise.all([
      this.prisma.room.findUnique({
        where: { id: roomId },
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
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              minEntryAmount: true,
              maxEntryAmount: true,
              maxPlayers: true,
              roundDurationMs: true,
            },
          },
        },
      }),
      this.prisma.round.findFirst({
        where: {
          roomId,
          status: { in: ACTIVE_ROUND_STATUSES },
        },
        orderBy: { roundNumber: "desc" },
        select: {
          id: true,
          roomId: true,
          roundNumber: true,
          status: true,
          totalEntryAmount: true,
          houseFeeAmount: true,
          payoutAmount: true,
          openedAt: true,
          locksAt: true,
          lockedAt: true,
          drawingAt: true,
          spinningAt: true,
          settlingAt: true,
          completedAt: true,
          cancelledAt: true,
          serverSeedHash: true,
          winningTicket: true,
          winnerUserId: true,
          winnerEntryId: true,
          spinAngle: true,
        },
      }),
    ]);

    if (!room) {
      throw new BadRequestException("Room not found.");
    }

    const entries = currentRound
      ? await this.prisma.entry.findMany({
          where: { roundId: currentRound.id },
          select: {
            id: true,
            roundId: true,
            userId: true,
            amount: true,
            ticketStart: true,
            ticketEnd: true,
            isWinner: true,
            createdAt: true,
            updatedAt: true,
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

    const serverNow = new Date();

    return {
      serverNow: serverNow.toISOString(),
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
      currentRound: currentRound
        ? this.toRoundSnapshot(currentRound, serverNow)
        : null,
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

  private toRoundSnapshot(
    round: {
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
    },
    serverNow = new Date(),
  ) {
    const msUntilLock =
      round.status === RoundStatus.OPEN && round.locksAt
        ? Math.max(0, round.locksAt.getTime() - serverNow.getTime())
        : 0;

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
      msUntilLock,
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
