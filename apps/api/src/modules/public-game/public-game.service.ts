import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, RoomStatus, RoundStatus } from '@kingspin/db';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeMetricsService } from '../redis/realtime-metrics.service';
import { RedisService } from '../redis/redis.service';
import {
  buildPublicRoundPhaseView,
  PUBLIC_CANCELLED_ROUND_VISIBILITY_MS,
  PUBLIC_COMPLETED_ROUND_VISIBILITY_MS,
} from '../rounds/public-round-phase';
import type {
  PublicRoundPhase,
  PublicRoundResultReason,
} from '@kingspin/contracts';

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

const COMPLETED_ROUND_VISIBILITY_MS = PUBLIC_COMPLETED_ROUND_VISIBILITY_MS;
const CANCELLED_ROUND_VISIBILITY_MS = PUBLIC_CANCELLED_ROUND_VISIBILITY_MS;

type RoomLiveStateSnapshot = {
  serverNow: string;
  room: {
    id: string;
    categoryId: string;
    code: string;
    name: string | null;
    status: string;
    gameMode: string;
    fixedEntryAmount: string | null;
    isPermanent: boolean;
    maxPlayers: number;
    roundDurationMs: number;
    activatedAt: string | null;
  };
  category: {
    id: string;
    name: string | null;
    slug: string;
    minEntryAmount: string;
    maxEntryAmount: string;
    maxPlayers: number;
    roundDurationMs: number;
  };
  currentRound: {
    id: string;
    roomId: string;
    roundNumber: number;
    status: RoundStatus;
    phase: PublicRoundPhase;
    phaseLabel: string;
    totalEntryAmount: string;
    houseFeeAmount: string;
    payoutAmount: string;
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
    msUntilLock: number;
    msUntilPhaseEnd: number;
    msUntilNextRound: number | null;
    resultReason: PublicRoundResultReason;
  } | null;
  entries: {
    id: string;
    roundId: string;
    userId: string;
    player: {
      id: string;
      username: string;
      fullName: string;
    };
    amount: string;
    ticketStart: string | null;
    ticketEnd: string | null;
    isWinner: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
};

type LiveStateCacheEntry = {
  snapshot: RoomLiveStateSnapshot;
  expiresAt: number;
  version: number;
};

type RedisLiveStateCacheEntry = {
  snapshot: RoomLiveStateSnapshot;
  version: number;
};

type RoomLiveStateRow = {
  roomId: string;
  roomCategoryId: string;
  roomCode: string;
  roomName: string | null;
  roomStatus: string;
  roomGameMode: string;
  roomFixedEntryAmount: bigint | null;
  roomIsPermanent: boolean;
  roomMaxPlayers: number;
  roomRoundDurationMs: number;
  roomActivatedAt: Date | null;
  categoryId: string;
  categoryName: string | null;
  categorySlug: string;
  categoryMinEntryAmount: bigint;
  categoryMaxEntryAmount: bigint;
  categoryMaxPlayers: number;
  categoryRoundDurationMs: number;
  roundId: string | null;
  roundRoomId: string | null;
  roundNumber: number | null;
  roundStatus: string | null;
  roundTotalEntryAmount: bigint | null;
  roundHouseFeeAmount: bigint | null;
  roundPayoutAmount: bigint | null;
  roundOpenedAt: Date | null;
  roundLocksAt: Date | null;
  roundLockedAt: Date | null;
  roundDrawingAt: Date | null;
  roundSpinningAt: Date | null;
  roundSettlingAt: Date | null;
  roundCompletedAt: Date | null;
  roundCancelledAt: Date | null;
  roundServerSeedHash: string | null;
  roundFairnessAlgorithm: string | null;
  roundEntriesHash: string | null;
  roundWinningTicket: bigint | null;
  roundWinnerUserId: string | null;
  roundWinnerEntryId: string | null;
  roundSpinAngle: number | null;
  entryId: string | null;
  entryRoundId: string | null;
  entryUserId: string | null;
  entryAmount: bigint | null;
  entryTicketStart: bigint | null;
  entryTicketEnd: bigint | null;
  entryIsWinner: boolean | null;
  entryCreatedAt: Date | null;
  entryUpdatedAt: Date | null;
  entryPlayerId: string | null;
  entryPlayerUsername: string | null;
  entryPlayerFullName: string | null;
};

const LIVE_STATE_CACHE_TTL_MS = 500;
const LIVE_STATE_INVALIDATION_CHANNEL = 'room-live-state:invalidate';
const LIVE_STATE_TIMING_WARN_THRESHOLD_MS = 300;

@Injectable()
export class PublicGameService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublicGameService.name);

  private readonly inFlightLiveStateByRoom = new Map<
    string,
    Promise<RoomLiveStateSnapshot>
  >();

  private readonly liveStateCacheByRoom = new Map<
    string,
    LiveStateCacheEntry
  >();
  private readonly liveStateVersionsByRoom = new Map<string, number>();
  private unsubscribeInvalidations: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly metrics?: RealtimeMetricsService,
  ) {}

  async onModuleInit() {
    this.unsubscribeInvalidations =
      (await this.redisService?.subscribe(
        LIVE_STATE_INVALIDATION_CHANNEL,
        (roomId) => {
          this.invalidateRoomLiveStateLocal(roomId);
        },
      )) ?? null;
  }

  async onModuleDestroy() {
    await this.unsubscribeInvalidations?.();
    this.unsubscribeInvalidations = null;
  }

  async getRoomLiveState(roomId: string): Promise<RoomLiveStateSnapshot> {
    const startedAt = Date.now();

    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const versionStartedAt = Date.now();
    const version = await this.getLiveStateVersion(roomId);
    const versionMs = Date.now() - versionStartedAt;
    const cacheStartedAt = Date.now();
    const cached = await this.getCachedLiveState(roomId, version);
    const cacheMs = Date.now() - cacheStartedAt;

    if (cached) {
      this.logLiveStateRequestTiming(roomId, {
        source: 'cache',
        totalMs: Date.now() - startedAt,
        cacheMs,
        versionMs,
        entryCount: cached.entries.length,
      });
      return cached;
    }

    /**
     * Performance fix:
     *
     * This endpoint is called by normal page refreshes and socket broadcasts.
     * If several callers ask for the same room at the same time, they share one
     * Supabase query. A tiny cache covers immediate REST/socket pileups after a
     * broadcast; invalidation bumps a version so old in-flight work cannot cache
     * stale state after an entry or round transition.
     *
     * This is room snapshot caching only. Wallet balances remain database truth.
     */
    const inFlightKey = this.getInFlightKey(roomId, version);
    const existingInFlight = this.inFlightLiveStateByRoom.get(inFlightKey);

    if (existingInFlight) {
      const waitStartedAt = Date.now();
      const snapshot = await existingInFlight;

      this.logLiveStateRequestTiming(roomId, {
        source: 'in-flight',
        totalMs: Date.now() - startedAt,
        cacheMs,
        versionMs,
        inFlightWaitMs: Date.now() - waitStartedAt,
        entryCount: snapshot.entries.length,
      });

      return snapshot;
    }

    const request = this.measureLiveState(roomId, () =>
      this.buildRoomLiveState(roomId),
    )
      .then((snapshot) => {
        void this.cacheRoomLiveStateIfFresh(roomId, version, snapshot).catch(
          (error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : 'Unknown live-state cache error';
            this.logger.warn(
              `Failed to cache live-state for ${roomId}: ${message}`,
            );
          },
        );

        return snapshot;
      })
      .finally(() => {
        if (this.inFlightLiveStateByRoom.get(inFlightKey) === request) {
          this.inFlightLiveStateByRoom.delete(inFlightKey);
        }
      });

    this.inFlightLiveStateByRoom.set(inFlightKey, request);

    const snapshot = await request;

    this.logLiveStateRequestTiming(roomId, {
      source: 'db',
      totalMs: Date.now() - startedAt,
      cacheMs,
      versionMs,
      entryCount: snapshot.entries.length,
    });

    return snapshot;
  }

  async invalidateRoomLiveState(roomId: string) {
    if (!roomId) {
      return;
    }

    this.invalidateRoomLiveStateLocal(roomId);

    if (this.redisService?.isAvailable()) {
      await Promise.allSettled([
        this.redisService.del(this.getRedisCacheKey(roomId)),
        this.redisService.incr(
          this.getRedisVersionKey(roomId),
          60 * 60 * 1_000,
        ),
        this.redisService.publish(LIVE_STATE_INVALIDATION_CHANNEL, roomId),
      ]);
    }
  }

  private invalidateRoomLiveStateLocal(roomId: string) {
    if (!roomId) {
      return;
    }

    this.liveStateCacheByRoom.delete(roomId);

    for (const key of this.inFlightLiveStateByRoom.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.inFlightLiveStateByRoom.delete(key);
      }
    }

    this.liveStateVersionsByRoom.set(
      roomId,
      this.getLocalLiveStateVersion(roomId) + 1,
    );
  }

  private async measureLiveState<T>(roomId: string, work: () => Promise<T>) {
    const startedAt = Date.now();

    try {
      return await work();
    } finally {
      this.metrics?.increment('liveStateBuildCount');
      const durationMs = Date.now() - startedAt;

      if (durationMs >= LIVE_STATE_TIMING_WARN_THRESHOLD_MS) {
        this.logger.warn(
          `[live-state-timing:${roomId}] build duration=${durationMs}ms`,
        );
      }
    }
  }

  private async measureLiveStatePart<T>(
    roomId: string,
    label: string,
    work: () => Promise<T> | T,
  ) {
    const startedAt = Date.now();

    try {
      return await work();
    } finally {
      this.logLiveStatePart(roomId, label, Date.now() - startedAt);
    }
  }

  private logLiveStatePart(
    roomId: string,
    label: string,
    durationMs: number,
    details?: string,
  ) {
    if (durationMs < LIVE_STATE_TIMING_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[live-state-timing:${roomId}] ${label} duration=${durationMs}ms${
        details ? ` ${details}` : ''
      }`,
    );
  }

  private logLiveStateRequestTiming(
    roomId: string,
    details: {
      source: 'cache' | 'in-flight' | 'db';
      totalMs: number;
      versionMs: number;
      cacheMs: number;
      inFlightWaitMs?: number;
      entryCount?: number;
    },
  ) {
    if (details.totalMs < LIVE_STATE_TIMING_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[live-state-timing:${roomId}] source=${details.source} total=${details.totalMs}ms version=${details.versionMs}ms cache=${details.cacheMs}ms inFlightWait=${details.inFlightWaitMs ?? 0}ms entries=${details.entryCount ?? 'n/a'} dbWaitMayBeIncluded=true`,
    );
  }

  private async buildRoomLiveState(
    roomId: string,
  ): Promise<RoomLiveStateSnapshot> {
    const rows = await this.measureLiveStatePart(
      roomId,
      'room/round query',
      () => this.queryRoomLiveStateRows(roomId),
    );

    const entryRowCount = rows.filter((row) => row.entryId).length;

    this.logLiveStatePart(
      roomId,
      'entries query',
      0,
      `source=joined rows=${entryRowCount}`,
    );

    return this.measureLiveStatePart(roomId, 'serialization', () =>
      this.serializeRoomLiveStateRows(rows),
    );
  }

  private async queryRoomLiveStateRows(roomId: string) {
    const activeStatuses = Prisma.join(
      ACTIVE_ROUND_STATUSES.map(
        (status) => Prisma.sql`CAST(${status} AS "RoundStatus")`,
      ),
    );
    const completedVisibleSince = new Date(
      Date.now() - COMPLETED_ROUND_VISIBILITY_MS,
    );
    const cancelledVisibleSince = new Date(
      Date.now() - CANCELLED_ROUND_VISIBILITY_MS,
    );

    return this.prisma.$queryRaw<RoomLiveStateRow[]>(Prisma.sql`
      SELECT
        r.id AS "roomId",
        r."categoryId" AS "roomCategoryId",
        r.code AS "roomCode",
        r.name AS "roomName",
        r.status::text AS "roomStatus",
        r."gameMode"::text AS "roomGameMode",
        r."fixedEntryAmount" AS "roomFixedEntryAmount",
        r."isPermanent" AS "roomIsPermanent",
        r."maxPlayers" AS "roomMaxPlayers",
        r."roundDurationMs" AS "roomRoundDurationMs",
        r."activatedAt" AS "roomActivatedAt",
        c.id AS "categoryId",
        c.name AS "categoryName",
        c.slug AS "categorySlug",
        c."minEntryAmount" AS "categoryMinEntryAmount",
        c."maxEntryAmount" AS "categoryMaxEntryAmount",
        c."maxPlayers" AS "categoryMaxPlayers",
        c."roundDurationMs" AS "categoryRoundDurationMs",
        cr.id AS "roundId",
        cr."roomId" AS "roundRoomId",
        cr."roundNumber" AS "roundNumber",
        cr.status::text AS "roundStatus",
        cr."totalEntryAmount" AS "roundTotalEntryAmount",
        cr."houseFeeAmount" AS "roundHouseFeeAmount",
        cr."payoutAmount" AS "roundPayoutAmount",
        cr."openedAt" AS "roundOpenedAt",
        cr."locksAt" AS "roundLocksAt",
        cr."lockedAt" AS "roundLockedAt",
        cr."drawingAt" AS "roundDrawingAt",
        cr."spinningAt" AS "roundSpinningAt",
        cr."settlingAt" AS "roundSettlingAt",
        cr."completedAt" AS "roundCompletedAt",
        cr."cancelledAt" AS "roundCancelledAt",
        cr."serverSeedHash" AS "roundServerSeedHash",
        cr."fairnessAlgorithm" AS "roundFairnessAlgorithm",
        cr."entriesHash" AS "roundEntriesHash",
        cr."winningTicket" AS "roundWinningTicket",
        cr."winnerUserId" AS "roundWinnerUserId",
        cr."winnerEntryId" AS "roundWinnerEntryId",
        cr."spinAngle" AS "roundSpinAngle",
        e.id AS "entryId",
        e."roundId" AS "entryRoundId",
        e."userId" AS "entryUserId",
        e.amount AS "entryAmount",
        e."ticketStart" AS "entryTicketStart",
        e."ticketEnd" AS "entryTicketEnd",
        e."isWinner" AS "entryIsWinner",
        e."createdAt" AS "entryCreatedAt",
        e."updatedAt" AS "entryUpdatedAt",
        u.id AS "entryPlayerId",
        u.username AS "entryPlayerUsername",
        u."fullName" AS "entryPlayerFullName"
      FROM rooms r
      JOIN categories c ON c.id = r."categoryId"
      LEFT JOIN LATERAL (
        SELECT
          ro.id,
          ro."roomId",
          ro."roundNumber",
          ro.status,
          ro."totalEntryAmount",
          ro."houseFeeAmount",
          ro."payoutAmount",
          ro."openedAt",
          ro."locksAt",
          ro."lockedAt",
          ro."drawingAt",
          ro."spinningAt",
          ro."settlingAt",
          ro."completedAt",
          ro."cancelledAt",
          ro."serverSeedHash",
          ro."fairnessAlgorithm",
          ro."entriesHash",
          ro."winningTicket",
          ro."winnerUserId",
          ro."winnerEntryId",
          ro."spinAngle"
        FROM rounds ro
        WHERE ro."roomId" = r.id
          AND (
            ro.status IN (${activeStatuses})
            OR (
              ro.status = CAST(${RoundStatus.COMPLETED} AS "RoundStatus")
              AND ro."completedAt" IS NOT NULL
              AND ro."completedAt" >= ${completedVisibleSince}
            )
            OR (
              ro.status = CAST(${RoundStatus.CANCELLED} AS "RoundStatus")
              AND ro."cancelledAt" IS NOT NULL
              AND ro."cancelledAt" >= ${cancelledVisibleSince}
            )
            OR (
              r.status = CAST(${RoomStatus.ACTIVE} AS "RoomStatus")
              AND r."isPermanent" = true
              AND ro.status IN (
                CAST(${RoundStatus.COMPLETED} AS "RoundStatus"),
                CAST(${RoundStatus.CANCELLED} AS "RoundStatus")
              )
            )
          )
        ORDER BY
          CASE
            WHEN ro.status IN (${activeStatuses}) THEN 0
            WHEN (
              ro.status = CAST(${RoundStatus.COMPLETED} AS "RoundStatus")
              AND ro."completedAt" IS NOT NULL
              AND ro."completedAt" >= ${completedVisibleSince}
            ) THEN 1
            WHEN (
              ro.status = CAST(${RoundStatus.CANCELLED} AS "RoundStatus")
              AND ro."cancelledAt" IS NOT NULL
              AND ro."cancelledAt" >= ${cancelledVisibleSince}
            ) THEN 1
            ELSE 2
          END,
          ro."roundNumber" DESC
        LIMIT 1
      ) cr ON true
      LEFT JOIN entries e ON e."roundId" = cr.id
      LEFT JOIN users u ON u.id = e."userId"
      WHERE r.id = ${roomId}
      ORDER BY e."createdAt" ASC NULLS LAST, e.id ASC NULLS LAST
    `);
  }

  private serializeRoomLiveStateRows(
    rows: RoomLiveStateRow[],
  ): RoomLiveStateSnapshot {
    const room = rows[0];

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

    const serverNow = new Date();

    const msUntilLock =
      room.roundStatus === RoundStatus.OPEN && room.roundLocksAt
        ? Math.max(0, room.roundLocksAt.getTime() - serverNow.getTime())
        : 0;
    const entryCount = rows.filter((entry) => Boolean(entry.entryId)).length;
    const publicRoundView = buildPublicRoundPhaseView(
      {
        status: room.roundStatus as RoundStatus | null,
        locksAt: room.roundLocksAt,
        lockedAt: room.roundLockedAt,
        drawingAt: room.roundDrawingAt,
        spinningAt: room.roundSpinningAt,
        settlingAt: room.roundSettlingAt,
        completedAt: room.roundCompletedAt,
        cancelledAt: room.roundCancelledAt,
        winnerEntryId: room.roundWinnerEntryId,
        entryCount,
      },
      serverNow,
    );
    const liveOpenEntryTotal =
      room.roundStatus === RoundStatus.OPEN
        ? rows.reduce((sum, row) => sum + (row.entryAmount ?? 0n), 0n)
        : null;

    return {
      serverNow: serverNow.toISOString(),
      room: {
        id: room.roomId,
        categoryId: room.roomCategoryId,
        code: room.roomCode,
        name: room.roomName,
        status: room.roomStatus,
        gameMode: room.roomGameMode,
        fixedEntryAmount: room.roomFixedEntryAmount?.toString() ?? null,
        isPermanent: room.roomIsPermanent,
        maxPlayers: room.roomMaxPlayers,
        roundDurationMs: room.roomRoundDurationMs,
        activatedAt: room.roomActivatedAt?.toISOString() ?? null,
      },
      category: {
        id: room.categoryId,
        name: room.categoryName,
        slug: room.categorySlug,
        minEntryAmount: room.categoryMinEntryAmount.toString(),
        maxEntryAmount: room.categoryMaxEntryAmount.toString(),
        maxPlayers: room.categoryMaxPlayers,
        roundDurationMs: room.categoryRoundDurationMs,
      },
      currentRound: room.roundId
        ? {
            id: room.roundId,
            roomId: room.roundRoomId ?? room.roomId,
            roundNumber: room.roundNumber ?? 0,
            status: room.roundStatus as RoundStatus,
            phase: publicRoundView.phase,
            phaseLabel: publicRoundView.phaseLabel,
            totalEntryAmount: (
              liveOpenEntryTotal ??
              room.roundTotalEntryAmount ??
              0n
            ).toString(),
            houseFeeAmount: room.roundHouseFeeAmount?.toString() ?? '0',
            payoutAmount: (
              liveOpenEntryTotal ??
              room.roundPayoutAmount ??
              0n
            ).toString(),
            openedAt:
              room.roundOpenedAt?.toISOString() ?? serverNow.toISOString(),
            locksAt: room.roundLocksAt?.toISOString() ?? null,
            lockedAt: room.roundLockedAt?.toISOString() ?? null,
            drawingAt: room.roundDrawingAt?.toISOString() ?? null,
            spinningAt: room.roundSpinningAt?.toISOString() ?? null,
            settlingAt: room.roundSettlingAt?.toISOString() ?? null,
            completedAt: room.roundCompletedAt?.toISOString() ?? null,
            cancelledAt: room.roundCancelledAt?.toISOString() ?? null,

            // Safe to expose before draw.
            serverSeedHash: room.roundServerSeedHash,
            fairnessAlgorithm: room.roundFairnessAlgorithm,
            entriesHash: room.roundEntriesHash,

            // Do NOT expose serverSeedReveal here.
            winningTicket: room.roundWinningTicket?.toString() ?? null,
            winnerUserId: room.roundWinnerUserId,
            winnerEntryId: room.roundWinnerEntryId,
            spinAngle: room.roundSpinAngle,
            msUntilLock,
            msUntilPhaseEnd: publicRoundView.msUntilPhaseEnd,
            msUntilNextRound: publicRoundView.msUntilNextRound,
            resultReason: publicRoundView.resultReason,
          }
        : null,
      entries: rows.flatMap((entry) => {
        if (!entry.entryId) {
          return [];
        }

        return {
          id: entry.entryId,
          roundId: entry.entryRoundId ?? '',
          userId: entry.entryUserId ?? '',
          player: {
            id: entry.entryPlayerId ?? entry.entryUserId ?? '',
            username: entry.entryPlayerUsername ?? '',
            fullName: entry.entryPlayerFullName ?? '',
          },
          amount: entry.entryAmount?.toString() ?? '0',
          ticketStart: entry.entryTicketStart?.toString() ?? null,
          ticketEnd: entry.entryTicketEnd?.toString() ?? null,
          isWinner: entry.entryIsWinner ?? false,
          createdAt:
            entry.entryCreatedAt?.toISOString() ?? serverNow.toISOString(),
          updatedAt:
            entry.entryUpdatedAt?.toISOString() ?? serverNow.toISOString(),
        };
      }),
    };
  }

  private async cacheRoomLiveStateIfFresh(
    roomId: string,
    version: number,
    snapshot: RoomLiveStateSnapshot,
  ) {
    const currentVersion = await this.getLiveStateVersion(roomId);

    if (currentVersion !== version) {
      return;
    }

    this.liveStateCacheByRoom.set(roomId, {
      snapshot,
      expiresAt: Date.now() + LIVE_STATE_CACHE_TTL_MS,
      version,
    });

    if (this.redisService?.isAvailable()) {
      await this.redisService.set(
        this.getRedisCacheKey(roomId),
        JSON.stringify({
          snapshot,
          version,
        } satisfies RedisLiveStateCacheEntry),
        LIVE_STATE_CACHE_TTL_MS,
      );
    }
  }

  private async getCachedLiveState(roomId: string, version: number) {
    const cached = this.liveStateCacheByRoom.get(roomId);

    if (cached && cached.expiresAt > Date.now() && cached.version === version) {
      this.metrics?.increment('liveStateCacheHitCount');
      this.logLiveStatePart(roomId, 'cache hit', 0, 'source=memory');
      return cached.snapshot;
    }

    if (cached) {
      this.liveStateCacheByRoom.delete(roomId);
    }

    if (!this.redisService?.isAvailable()) {
      this.metrics?.increment('liveStateCacheMissCount');
      this.logLiveStatePart(roomId, 'cache miss', 0, 'source=memory');
      return null;
    }

    const startedAt = Date.now();
    const rawCached = await this.redisService.get(
      this.getRedisCacheKey(roomId),
    );

    if (!rawCached) {
      this.metrics?.increment('liveStateCacheMissCount');
      this.metrics?.increment('liveStateRedisCacheMissCount');
      this.logLiveStatePart(
        roomId,
        'cache miss',
        Date.now() - startedAt,
        'source=redis',
      );
      return null;
    }

    try {
      const parsed = JSON.parse(rawCached) as RedisLiveStateCacheEntry;

      if (parsed.version !== version) {
        this.metrics?.increment('liveStateCacheMissCount');
        this.metrics?.increment('liveStateRedisCacheMissCount');
        this.logLiveStatePart(
          roomId,
          'cache miss',
          Date.now() - startedAt,
          'source=redis reason=version',
        );
        return null;
      }

      this.liveStateCacheByRoom.set(roomId, {
        snapshot: parsed.snapshot,
        expiresAt: Date.now() + LIVE_STATE_CACHE_TTL_MS,
        version,
      });

      this.metrics?.increment('liveStateCacheHitCount');
      this.metrics?.increment('liveStateRedisCacheHitCount');
      this.logLiveStatePart(
        roomId,
        'cache hit',
        Date.now() - startedAt,
        'source=redis',
      );

      return parsed.snapshot;
    } catch {
      this.metrics?.increment('liveStateCacheMissCount');
      this.metrics?.increment('liveStateRedisCacheMissCount');
      this.logLiveStatePart(
        roomId,
        'cache miss',
        Date.now() - startedAt,
        'source=redis reason=parse',
      );
      return null;
    }
  }

  private async getLiveStateVersion(roomId: string) {
    if (this.redisService?.isAvailable()) {
      const rawVersion = await this.redisService.get(
        this.getRedisVersionKey(roomId),
      );
      const redisVersion = rawVersion ? Number(rawVersion) : 0;

      if (Number.isFinite(redisVersion)) {
        this.liveStateVersionsByRoom.set(roomId, redisVersion);
        return redisVersion;
      }
    }

    return this.getLocalLiveStateVersion(roomId);
  }

  private getLocalLiveStateVersion(roomId: string) {
    return this.liveStateVersionsByRoom.get(roomId) ?? 0;
  }

  private getInFlightKey(roomId: string, version: number) {
    return `${roomId}:${version}`;
  }

  private getRedisCacheKey(roomId: string) {
    return `room-live-state:${roomId}`;
  }

  private getRedisVersionKey(roomId: string) {
    return `room-live-state:${roomId}:version`;
  }

  getLiveStateMetrics() {
    return this.metrics?.snapshot() ?? null;
  }
}
