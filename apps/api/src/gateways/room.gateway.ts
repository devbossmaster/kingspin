import {
  BadRequestException,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
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
} from '@nestjs/websockets';
import {
  SOCKET_EVENTS,
  SocketCategoryJoinAckSchema,
  SocketCategoryJoinPayloadSchema,
  SocketCategoryLeaveAckSchema,
  SocketCategoryLeavePayloadSchema,
  SocketCategoryStateEventSchema,
  SocketMachineEventSchema,
  SocketPresenceEventSchema,
  SocketSpinBattleOnlineEventSchema,
  SocketRoomJoinAckSchema,
  SocketRoomJoinPayloadSchema,
  SocketRoomLeaveAckSchema,
  SocketRoomLeavePayloadSchema,
  SocketRoundStateEventSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@kingspin/contracts';
import { RoundStatus } from '@kingspin/db';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { getApiEnv } from '../config/api-env';
import type { AuthBridgeUser } from '../modules/auth-bridge/auth.types';
import { AuthBridgeService } from '../modules/auth-bridge/auth-bridge.service';
import { PublicGameService } from '../modules/public-game/public-game.service';
import { RealtimeMetricsService } from '../modules/redis/realtime-metrics.service';
import { RoomsService } from '../modules/rooms/rooms.service';
import {
  RedisService,
  type RedisDedicatedClient,
  type RedisLock,
} from '../modules/redis/redis.service';

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocketData = {
  userId?: string;
};
type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  GameSocketData
>;
type RedisAdapterClient = RedisDedicatedClient;
type PendingRoomBroadcast = {
  timer: ReturnType<typeof setTimeout>;
  reasons: Set<string>;
  count: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  promise: Promise<void>;
};
type PendingCategoryBroadcast = PendingRoomBroadcast & {
  useCachedSummary: boolean;
};
type OpenRoundSummaryPatch = {
  id: string;
  roomId: string;
  roundNumber: number;
  status: RoundStatus;
  totalEntryAmount: string;
  houseFeeAmount: string;
  payoutAmount: string;
  grossPoolAmount: string;
  platformFeeAmount: string;
  netPrizeAmount: string;
  platformFeeBps: number;
  openedAt: string;
  locksAt: string | null;
  lockedAt: string | null;
  drawingAt: string | null;
  spinningAt: string | null;
  settlingAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  serverSeedHash: string | null;
  fairnessAlgorithm: string | null;
  entriesHash: string | null;
  winningTicket: string | null;
  winnerUserId: string | null;
  winnerEntryId: string | null;
  spinAngle: number | null;
};

const ROOM_BROADCAST_COALESCE_MS = 50;
const ROOM_BROADCAST_REDIS_LOCK_TTL_MS = 1_000;
const PRESENCE_TTL_MS = 30_000;
const PRESENCE_HEARTBEAT_MS = 15_000;
const BROADCAST_TIMING_WARN_THRESHOLD_MS = 300;

function allowConfiguredSocketOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) {
  const allowedOrigin = getApiEnv().API_CORS_ORIGIN;

  callback(null, !origin || origin === allowedOrigin);
}

@WebSocketGateway({
  namespace: '/game',
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
  private redisPublisher: RedisAdapterClient | null = null;
  private redisSubscriber: RedisAdapterClient | null = null;
  private readonly pendingBroadcastsByRoom = new Map<
    string,
    PendingRoomBroadcast
  >();
  private readonly pendingBroadcastsByCategory = new Map<
    string,
    PendingCategoryBroadcast
  >();
  private readonly pendingOpenRoundSummaryPatchesByRoom = new Map<
    string,
    OpenRoundSummaryPatch
  >();
  private readonly socketRoomsById = new Map<string, Set<string>>();
  private presenceHeartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly publicGameService: PublicGameService,
    private readonly roomsService: RoomsService,
    private readonly authBridgeService: AuthBridgeService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly metrics?: RealtimeMetricsService,
  ) {}

  async afterInit(server: GameServer) {
    const env = getApiEnv();

    await this.configureRedisAdapter(server);

    this.logger.log('Socket.IO /game namespace initialized.');
    this.startPresenceHeartbeat();

    if (env.NODE_ENV === 'production' && !env.ENABLE_REDIS) {
      this.logger.warn(
        'Socket.IO Redis adapter is disabled. Production scaling requires sticky sessions or a Redis adapter.',
      );
    }
  }

  async onModuleDestroy() {
    if (this.presenceHeartbeat) {
      clearInterval(this.presenceHeartbeat);
      this.presenceHeartbeat = null;
    }

    for (const pending of this.pendingBroadcastsByRoom.values()) {
      clearTimeout(pending.timer);
      pending.resolve();
    }

    for (const pending of this.pendingBroadcastsByCategory.values()) {
      clearTimeout(pending.timer);
      pending.resolve();
    }

    this.pendingBroadcastsByRoom.clear();
    this.pendingBroadcastsByCategory.clear();
    this.pendingOpenRoundSummaryPatchesByRoom.clear();

    await Promise.allSettled([
      this.redisSubscriber?.quit(),
      this.redisPublisher?.quit(),
    ]);
  }

  async handleConnection(client: GameSocket) {
    try {
      const user = await this.authenticateSocket(client);

      if (!user) {
        client.disconnect(true);
        return;
      }

      this.logger.log(`Socket connected: ${client.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown socket auth error';

      this.logger.warn(`Socket auth failed for ${client.id}: ${message}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: GameSocket) {
    await this.clearSocketPresence(client.id);
    this.emitSpinBattleOnlinePresence();
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage(SOCKET_EVENTS.ROOM_JOIN)
  async handleJoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ) {
    await this.requireAuthenticatedSocket(client);

    const parsedPayload = SocketRoomJoinPayloadSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new WsException('Invalid room:join payload.');
    }

    const roomId = this.parseRoomId(parsedPayload.data.roomId);

    await client.join(roomId);
    await this.markSocketPresence(client.id, roomId);
    this.logRealtimeDebug(
      `room joined roomId=${roomId} socketId=${client.id} reason=JOINED_ROOM`,
    );

    const snapshot = await this.getRoomStateSnapshot(roomId);
    const emittedAt = new Date().toISOString();

    const roundState = SocketRoundStateEventSchema.parse({
      roomId,
      reason: 'JOINED_ROOM',
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
    this.emitSpinBattleOnlinePresence();

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
      throw new WsException('Invalid room:leave payload.');
    }

    const roomId = this.parseRoomId(parsedPayload.data.roomId);

    await client.leave(roomId);
    await this.clearSocketPresence(client.id, roomId);

    const leftAt = new Date().toISOString();
    const presence = SocketPresenceEventSchema.parse({
      roomId,
      socketId: client.id,
      leftAt,
    });

    client.to(roomId).emit(SOCKET_EVENTS.ROOM_PLAYER_LEFT, presence);
    this.emitSpinBattleOnlinePresence();

    return SocketRoomLeaveAckSchema.parse({
      ok: true,
      roomId,
      leftAt,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.CATEGORY_JOIN)
  async handleCategoryJoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ) {
    await this.requireAuthenticatedSocket(client);

    const parsedPayload = SocketCategoryJoinPayloadSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new WsException('Invalid category:join payload.');
    }

    const categorySlug = this.parseCategorySlug(
      parsedPayload.data.categorySlug,
    );
    const channel = this.getCategoryChannel(categorySlug);

    await client.join(channel);
    this.logRealtimeDebug(
      `category joined categorySlug=${categorySlug} socketId=${client.id} reason=JOINED_CATEGORY`,
    );

    const rooms =
      await this.roomsService.findActiveByCategorySlug(categorySlug);
    const emittedAt = new Date().toISOString();
    const categoryState = SocketCategoryStateEventSchema.parse({
      categorySlug,
      reason: 'JOINED_CATEGORY',
      rooms,
      emittedAt,
    });

    client.emit(SOCKET_EVENTS.CATEGORY_STATE, categoryState);

    return SocketCategoryJoinAckSchema.parse({
      ok: true,
      categorySlug,
      joinedAt: emittedAt,
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.CATEGORY_LEAVE)
  async handleCategoryLeave(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ) {
    const parsedPayload = SocketCategoryLeavePayloadSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new WsException('Invalid category:leave payload.');
    }

    const categorySlug = this.parseCategorySlug(
      parsedPayload.data.categorySlug,
    );
    const channel = this.getCategoryChannel(categorySlug);

    await client.leave(channel);
    const leftAt = new Date().toISOString();

    return SocketCategoryLeaveAckSchema.parse({
      ok: true,
      categorySlug,
      leftAt,
    });
  }

  async broadcastRoundState(roomId: string, reason: string) {
    try {
      return this.scheduleRoomStateBroadcast(roomId, reason);
    } catch (error) {
      this.logBroadcastFailed(roomId, reason, error);
      throw error;
    }
  }

  async broadcastCategoryState(categorySlug: string, reason: string) {
    try {
      return this.scheduleCategoryStateBroadcast(categorySlug, reason);
    } catch (error) {
      this.logBroadcastFailed(
        this.getCategoryChannel(categorySlug),
        reason,
        error,
      );
      throw error;
    }
  }

  invalidateRoomState(roomId: string) {
    void this.publicGameService.invalidateRoomLiveState(roomId);
  }

  async broadcastMachineResult(roomId: string, result: unknown) {
    await Promise.resolve();

    const payload = this.toSocketSafePayload(result);

    /**
     * Performance fix:
     *
     * Do not block machine-event emission on a full room snapshot rebuild.
     * The caller already runs this in the background, but this keeps the gateway
     * itself responsive and avoids serial socket work.
     */
    const action =
      payload && typeof payload === 'object' && 'action' in payload
        ? String((payload as { action?: unknown }).action)
        : 'UNKNOWN';

    this.queueOpenRoundSummaryPatch(roomId, payload);

    void this.broadcastRoundState(roomId, action).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown round state error';

      this.logger.warn(
        `Failed to broadcast room state for ${roomId} after machine result: ${message}`,
      );
    });

    if (action === 'STARTED_OPEN_ROUND') {
      this.emitMachineEvent(
        roomId,
        SOCKET_EVENTS.ROUND_UPDATED,
        action,
        payload,
      );
      return;
    }

    if (
      action === 'CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT' ||
      action === 'CANCELLED_SINGLE_PLAYER_ROUND_AND_STARTED_NEXT' ||
      action === 'CANCELLED_EMPTY_LOCKED_ROUND_AND_STARTED_NEXT' ||
      action === 'CANCELLED_SINGLE_PLAYER_LOCKED_ROUND_AND_STARTED_NEXT' ||
      action === 'STARTED_NEXT_ROUND_AFTER_COMPLETION'
    ) {
      this.emitMachineEvent(
        roomId,
        SOCKET_EVENTS.ROUND_UPDATED,
        action,
        payload,
      );
      return;
    }

    if (action === 'LOCKED_ROUND') {
      this.emitMachineEvent(
        roomId,
        SOCKET_EVENTS.ROUND_LOCKED,
        action,
        payload,
      );
      return;
    }

    if (action === 'DREW_ROUND') {
      this.emitMachineEvent(
        roomId,
        SOCKET_EVENTS.ROUND_UPDATED,
        action,
        payload,
      );
      return;
    }

    if (action === 'STARTED_SPINNING_ROUND') {
      this.emitMachineEvent(
        roomId,
        SOCKET_EVENTS.ROUND_SPINNING,
        action,
        payload,
      );
      return;
    }

    if (
      action === 'STARTED_SETTLING_ROUND' ||
      action === 'SETTLED_ROUND' ||
      action === 'RESUMED_SETTLEMENT'
    ) {
      this.emitMachineEvent(
        roomId,
        SOCKET_EVENTS.ROUND_SETTLED,
        action,
        payload,
      );
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
      const message = 'ENABLE_REDIS=true but REDIS_URL is missing.';

      if (env.NODE_ENV === 'production') {
        throw new Error(message);
      }

      this.logger.warn(message);
      return;
    }

    try {
      const [publisher, subscriber] = await Promise.all([
        this.redisService?.createDedicatedClient('socket.io:publisher') ?? null,
        this.redisService?.createDedicatedClient('socket.io:subscriber') ??
          null,
      ]);

      if (!publisher || !subscriber) {
        return;
      }

      server.adapter(createAdapter(publisher as any, subscriber as any));

      this.redisPublisher = publisher;
      this.redisSubscriber = subscriber;

      this.logger.log('Socket.IO Redis adapter enabled for /game namespace.');
    } catch (error) {
      await Promise.allSettled([
        this.redisSubscriber?.quit(),
        this.redisPublisher?.quit(),
      ]);
      this.redisPublisher = null;
      this.redisSubscriber = null;

      const message =
        error instanceof Error ? error.message : 'Unknown Redis adapter error';

      if (env.NODE_ENV === 'production') {
        this.logger.error(`Socket.IO Redis adapter failed: ${message}`);
        throw error;
      }

      this.logger.warn(
        `Socket.IO Redis adapter failed; continuing without Redis in ${env.NODE_ENV}: ${message}`,
      );
    }
  }

  private parseRoomId(rawRoomId: unknown) {
    if (typeof rawRoomId !== 'string' || rawRoomId.trim().length === 0) {
      throw new BadRequestException('roomId is required.');
    }

    return rawRoomId.trim();
  }

  private parseCategorySlug(rawCategorySlug: unknown) {
    if (
      typeof rawCategorySlug !== 'string' ||
      rawCategorySlug.trim().length === 0
    ) {
      throw new BadRequestException('categorySlug is required.');
    }

    return rawCategorySlug.trim();
  }

  private getCategoryChannel(categorySlug: string) {
    return `category:${categorySlug}`;
  }

  private async getRoomStateSnapshot(roomId: string) {
    return this.publicGameService.getRoomLiveState(roomId);
  }

  private async requireAuthenticatedSocket(client: GameSocket) {
    const user = await this.authenticateSocket(client);

    if (!user) {
      throw new WsException('Authentication required.');
    }

    return user;
  }

  private async authenticateSocket(
    client: GameSocket,
  ): Promise<AuthBridgeUser | null> {
    if (client.data.userId) {
      return { id: client.data.userId };
    }

    const user = await this.authBridgeService.validateRequest({
      headers: client.handshake.headers,
    });

    if (!user?.id) {
      return null;
    }

    client.data.userId = user.id;
    return user;
  }

  private scheduleRoomStateBroadcast(roomId: string, reason: string) {
    const existing = this.pendingBroadcastsByRoom.get(roomId);

    if (existing) {
      existing.reasons.add(reason);
      existing.count += 1;
      this.metrics?.increment('socketCoalescedBroadcastCount');
      this.logRealtimeDebug(
        `broadcast scheduled roomId=${roomId} reason=${reason} coalesced=true pending=${existing.count}`,
      );
      return existing.promise;
    }

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });

    const pending: PendingRoomBroadcast = {
      timer: setTimeout(() => {
        void this.flushRoomStateBroadcast(roomId).catch((error: unknown) => {
          const current = this.pendingBroadcastsByRoom.get(roomId);
          current?.reject(error);
        });
      }, ROOM_BROADCAST_COALESCE_MS),
      reasons: new Set([reason]),
      count: 1,
      resolve,
      reject,
      promise,
    };

    this.pendingBroadcastsByRoom.set(roomId, pending);
    this.logRealtimeDebug(
      `broadcast scheduled roomId=${roomId} reason=${reason} coalesced=false pending=1`,
    );

    return promise;
  }

  private async flushRoomStateBroadcast(roomId: string) {
    const startedAt = Date.now();
    const pending = this.pendingBroadcastsByRoom.get(roomId);

    if (!pending) {
      return;
    }

    this.pendingBroadcastsByRoom.delete(roomId);

    let lock: RedisLock | null = null;

    try {
      if (this.redisService?.isAvailable()) {
        lock = await this.redisService.acquireLock(
          `room-broadcast:${roomId}`,
          ROOM_BROADCAST_REDIS_LOCK_TTL_MS,
        );

        if (!lock) {
          this.metrics?.increment(
            'socketCoalescedBroadcastCount',
            pending.count,
          );
          this.logger.log(
            `Skipped duplicate Redis-coalesced room broadcast for ${roomId}; pending=${pending.count}.`,
          );
          pending.resolve();
          return;
        }
      }

      const refreshSnapshots = this.shouldRefreshSnapshotsForReasons(
        pending.reasons,
      );

      if (refreshSnapshots) {
        await this.publicGameService.invalidateRoomLiveState(roomId);
      }

      const categorySlug = refreshSnapshots
        ? await this.roomsService.findCategorySlugForRoom(roomId)
        : null;

      if (categorySlug) {
        const openRoundPatch =
          this.pendingOpenRoundSummaryPatchesByRoom.get(roomId) ?? null;
        const useCachedSummary =
          openRoundPatch !== null &&
          this.roomsService.patchLiveRoomSummaryCacheWithOpenRound(
            roomId,
            openRoundPatch,
          );

        this.pendingOpenRoundSummaryPatchesByRoom.delete(roomId);

        if (!useCachedSummary) {
          this.roomsService.invalidateLiveRoomSummariesForCategory(
            categorySlug,
          );
        }

        void this.scheduleCategoryStateBroadcast(
          categorySlug,
          [...pending.reasons].join('+'),
          {
            useCachedSummary,
          },
        ).catch((error: unknown) => {
          this.logBroadcastFailed(
            this.getCategoryChannel(categorySlug),
            [...pending.reasons].join('+') || 'UNKNOWN',
            error,
          );
        });
      }

      if (!this.hasRoomObservers(roomId)) {
        this.metrics?.increment('socketCoalescedBroadcastCount', pending.count);
        this.logRealtimeDebug(
          `broadcast skipped roomId=${roomId} reason=${[...pending.reasons].join('+')} pending=${pending.count} observers=0`,
        );
        pending.resolve();
        return;
      }

      const snapshot = await this.getRoomStateSnapshot(roomId);
      const reasons = [...pending.reasons];
      const payload = SocketRoundStateEventSchema.parse({
        roomId,
        reason: reasons.length === 1 ? reasons[0] : reasons.join('+'),
        snapshot,
        emittedAt: new Date().toISOString(),
      });

      this.server.to(roomId).emit(SOCKET_EVENTS.ROUND_STATE, payload);
      this.metrics?.increment('socketBroadcastCount');
      this.metrics?.increment('socketBroadcastFlushCount');

      if (pending.count > 1) {
        this.logger.log(
          `Coalesced ${pending.count} room broadcasts into one snapshot for ${roomId}.`,
        );
      }

      this.logRealtimeDebug(
        `broadcast flushed roomId=${roomId} reason=${payload.reason} pending=${pending.count}`,
      );

      pending.resolve();
    } catch (error) {
      const reason = [...pending.reasons].join('+') || 'UNKNOWN';
      this.logBroadcastFailed(roomId, reason, error);
      pending.reject(error);
      throw error;
    } finally {
      if (lock) {
        await this.redisService?.releaseLock(lock);
      }

      this.logBroadcastTiming(roomId, 'room', Date.now() - startedAt, {
        pendingCount: pending.count,
        observers: this.hasRoomObservers(roomId),
      });
    }
  }

  private scheduleCategoryStateBroadcast(
    categorySlug: string,
    reason: string,
    options: { useCachedSummary?: boolean } = {},
  ) {
    const normalizedSlug = this.parseCategorySlug(categorySlug);
    const existing = this.pendingBroadcastsByCategory.get(normalizedSlug);

    if (existing) {
      existing.reasons.add(reason);
      existing.count += 1;
      existing.useCachedSummary =
        existing.useCachedSummary && options.useCachedSummary === true;
      this.metrics?.increment('socketCoalescedBroadcastCount');
      this.logRealtimeDebug(
        `category broadcast scheduled categorySlug=${normalizedSlug} reason=${reason} coalesced=true pending=${existing.count}`,
      );
      return existing.promise;
    }

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });

    const pending: PendingCategoryBroadcast = {
      timer: setTimeout(() => {
        void this.flushCategoryStateBroadcast(normalizedSlug).catch(
          (error: unknown) => {
            const current =
              this.pendingBroadcastsByCategory.get(normalizedSlug);
            current?.reject(error);
          },
        );
      }, ROOM_BROADCAST_COALESCE_MS),
      reasons: new Set([reason]),
      count: 1,
      resolve,
      reject,
      promise,
      useCachedSummary: options.useCachedSummary === true,
    };

    this.pendingBroadcastsByCategory.set(normalizedSlug, pending);
    this.logRealtimeDebug(
      `category broadcast scheduled categorySlug=${normalizedSlug} reason=${reason} coalesced=false pending=1`,
    );

    return promise;
  }

  private async flushCategoryStateBroadcast(categorySlug: string) {
    const startedAt = Date.now();
    const pending = this.pendingBroadcastsByCategory.get(categorySlug);

    if (!pending) {
      return;
    }

    this.pendingBroadcastsByCategory.delete(categorySlug);

    try {
      if (!pending.useCachedSummary) {
        this.roomsService.invalidateLiveRoomSummariesForCategory(categorySlug);
      }

      const channel = this.getCategoryChannel(categorySlug);

      if (!this.hasChannelObservers(channel)) {
        this.metrics?.increment('socketCoalescedBroadcastCount', pending.count);
        this.logRealtimeDebug(
          `category broadcast skipped categorySlug=${categorySlug} reason=${[...pending.reasons].join('+')} pending=${pending.count} observers=0`,
        );
        pending.resolve();
        return;
      }

      const rooms =
        await this.roomsService.findActiveByCategorySlug(categorySlug);
      const reasons = [...pending.reasons];
      const payload = SocketCategoryStateEventSchema.parse({
        categorySlug,
        reason: reasons.length === 1 ? reasons[0] : reasons.join('+'),
        rooms,
        emittedAt: new Date().toISOString(),
      });

      this.server.to(channel).emit(SOCKET_EVENTS.CATEGORY_STATE, payload);
      this.metrics?.increment('socketBroadcastCount');
      this.metrics?.increment('socketBroadcastFlushCount');
      this.logRealtimeDebug(
        `category broadcast flushed categorySlug=${categorySlug} reason=${payload.reason} pending=${pending.count}`,
      );

      pending.resolve();
    } catch (error) {
      const reason = [...pending.reasons].join('+') || 'UNKNOWN';
      this.logBroadcastFailed(
        this.getCategoryChannel(categorySlug),
        reason,
        error,
      );
      pending.reject(error);
      throw error;
    } finally {
      this.logBroadcastTiming(
        this.getCategoryChannel(categorySlug),
        'category',
        Date.now() - startedAt,
        {
          pendingCount: pending.count,
          observers: this.hasChannelObservers(
            this.getCategoryChannel(categorySlug),
          ),
        },
      );
    }
  }

  private async markSocketPresence(socketId: string, roomId: string) {
    let rooms = this.socketRoomsById.get(socketId);

    if (!rooms) {
      rooms = new Set<string>();
      this.socketRoomsById.set(socketId, rooms);
    }

    rooms.add(roomId);

    if (this.redisService?.isAvailable()) {
      await this.redisService.set(
        this.getPresenceKey(roomId, socketId),
        new Date().toISOString(),
        PRESENCE_TTL_MS,
      );
    }
  }

  private async clearSocketPresence(socketId: string, roomId?: string) {
    const rooms = this.socketRoomsById.get(socketId);
    const targetRooms = roomId ? new Set([roomId]) : rooms;

    if (!targetRooms) {
      return;
    }

    const redisService = this.redisService;

    if (redisService?.isAvailable()) {
      await Promise.allSettled(
        [...targetRooms].map((targetRoomId) =>
          redisService.del(this.getPresenceKey(targetRoomId, socketId)),
        ),
      );
    }

    if (roomId) {
      rooms?.delete(roomId);
      if (rooms?.size === 0) {
        this.socketRoomsById.delete(socketId);
      }
      return;
    }

    this.socketRoomsById.delete(socketId);
  }

  private startPresenceHeartbeat() {
    if (this.presenceHeartbeat || !this.redisService?.isAvailable()) {
      return;
    }

    this.presenceHeartbeat = setInterval(() => {
      const now = new Date().toISOString();

      for (const [socketId, rooms] of this.socketRoomsById) {
        for (const roomId of rooms) {
          void this.redisService
            ?.set(this.getPresenceKey(roomId, socketId), now, PRESENCE_TTL_MS)
            .catch((error: unknown) => {
              const message =
                error instanceof Error
                  ? error.message
                  : 'Unknown presence heartbeat error';
              this.logger.warn(`Presence heartbeat failed: ${message}`);
            });
        }
      }
    }, PRESENCE_HEARTBEAT_MS);
  }

  private getPresenceKey(roomId: string, socketId: string) {
    return `room-presence:${roomId}:${socketId}`;
  }

  private toSocketSafePayload(payload: unknown): unknown {
    return JSON.parse(
      JSON.stringify(payload, (_key: string, value: unknown) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }

        if (value instanceof Date) {
          return value.toISOString();
        }

        return value;
      }),
    ) as unknown;
  }

  private queueOpenRoundSummaryPatch(roomId: string, payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const currentRound = (payload as { currentRound?: unknown }).currentRound;

    if (!this.isOpenRoundSummaryPatch(currentRound)) {
      return;
    }

    this.pendingOpenRoundSummaryPatchesByRoom.set(roomId, currentRound);
  }

  getSpinBattleOnlinePresence() {
    const activeRooms = new Set<string>();
    let onlinePlayers = 0;

    for (const rooms of this.socketRoomsById.values()) {
      if (rooms.size === 0) {
        continue;
      }

      onlinePlayers += 1;

      for (const roomId of rooms) {
        activeRooms.add(roomId);
      }
    }

    return SocketSpinBattleOnlineEventSchema.parse({
      onlinePlayers,
      activeRooms: activeRooms.size,
      generatedAt: new Date().toISOString(),
    });
  }

  private emitSpinBattleOnlinePresence() {
    if (!this.server?.emit) {
      return;
    }

    this.server.emit(
      SOCKET_EVENTS.SPIN_BATTLE_ONLINE,
      this.getSpinBattleOnlinePresence(),
    );
  }

  private isOpenRoundSummaryPatch(
    value: unknown,
  ): value is OpenRoundSummaryPatch {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const round = value as Partial<OpenRoundSummaryPatch>;

    return (
      typeof round.id === 'string' &&
      typeof round.roomId === 'string' &&
      typeof round.roundNumber === 'number' &&
      round.status === RoundStatus.OPEN &&
      typeof round.totalEntryAmount === 'string' &&
      typeof round.houseFeeAmount === 'string' &&
      typeof round.payoutAmount === 'string' &&
      typeof round.grossPoolAmount === 'string' &&
      typeof round.platformFeeAmount === 'string' &&
      typeof round.netPrizeAmount === 'string' &&
      typeof round.platformFeeBps === 'number' &&
      typeof round.openedAt === 'string' &&
      (typeof round.locksAt === 'string' || round.locksAt === null) &&
      (typeof round.lockedAt === 'string' || round.lockedAt === null) &&
      (typeof round.drawingAt === 'string' || round.drawingAt === null) &&
      (typeof round.spinningAt === 'string' || round.spinningAt === null) &&
      (typeof round.settlingAt === 'string' || round.settlingAt === null) &&
      (typeof round.completedAt === 'string' || round.completedAt === null) &&
      (typeof round.cancelledAt === 'string' || round.cancelledAt === null) &&
      (typeof round.serverSeedHash === 'string' ||
        round.serverSeedHash === null) &&
      (typeof round.fairnessAlgorithm === 'string' ||
        round.fairnessAlgorithm === null) &&
      (typeof round.entriesHash === 'string' || round.entriesHash === null) &&
      (typeof round.winningTicket === 'string' ||
        round.winningTicket === null) &&
      (typeof round.winnerUserId === 'string' || round.winnerUserId === null) &&
      (typeof round.winnerEntryId === 'string' ||
        round.winnerEntryId === null) &&
      (typeof round.spinAngle === 'number' || round.spinAngle === null)
    );
  }

  private shouldRefreshSnapshotsForReasons(reasons: Set<string>) {
    for (const reason of reasons) {
      if (reason !== 'MACHINE_STARTED' && reason !== 'MACHINE_STOPPED') {
        return true;
      }
    }

    return false;
  }

  private hasRoomObservers(roomId: string) {
    return this.hasChannelObservers(roomId);
  }

  private hasChannelObservers(channel: string) {
    const adapterRooms = this.server?.sockets?.adapter?.rooms;

    if (!adapterRooms || typeof adapterRooms.get !== 'function') {
      return true;
    }

    const localSize = adapterRooms.get(channel)?.size ?? 0;

    if (localSize > 0) {
      return true;
    }

    // With a Redis adapter, another API instance may own the sockets for this
    // room. Stay conservative and emit the cross-node broadcast.
    return this.redisService?.isAvailable() === true;
  }

  private logBroadcastFailed(roomId: string, reason: string, error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown broadcast error';

    this.logRealtimeDebug(
      `broadcast failed roomId=${roomId} reason=${reason} error=${message}`,
    );
  }

  private logRealtimeDebug(message: string) {
    if (getApiEnv().APP_ENV !== 'local') {
      return;
    }

    this.logger.log(message);
  }

  private logBroadcastTiming(
    channel: string,
    kind: 'room' | 'category',
    durationMs: number,
    details: {
      pendingCount: number;
      observers: boolean;
    },
  ) {
    if (durationMs < BROADCAST_TIMING_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[socket-broadcast-timing:${channel}] kind=${kind} duration=${durationMs}ms pending=${details.pendingCount} observers=${details.observers} dbWaitMayBeIncluded=true`,
    );
  }
}
