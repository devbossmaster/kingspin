import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoomStatus, RoundStatus } from '@kingspin/db';
import { getApiEnv } from '../../config/api-env';
import { PrismaService } from '../../prisma/prisma.service';
import { RoundsService, type RoundSnapshot } from '../rounds/rounds.service';
import {
  buildPublicRoundPhaseView,
  PUBLIC_CANCELLED_ROUND_VISIBILITY_MS,
  PUBLIC_COMPLETED_ROUND_VISIBILITY_MS,
} from '../rounds/public-round-phase';

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

const PUBLIC_SUMMARY_ROUND_STATUSES: RoundStatus[] = [
  ...ACTIVE_ROUND_STATUSES,
  RoundStatus.COMPLETED,
  RoundStatus.CANCELLED,
];

const COMPLETED_ROUND_VISIBILITY_MS = PUBLIC_COMPLETED_ROUND_VISIBILITY_MS;
const CANCELLED_ROUND_VISIBILITY_MS = PUBLIC_CANCELLED_ROUND_VISIBILITY_MS;
const LIVE_ROOM_SUMMARY_CACHE_TTL_MS = 2_000;
const LIVE_ROOM_SUMMARY_STALE_TTL_MS = 30_000;
const LIVE_ROOM_SUMMARY_TIMING_WARN_THRESHOLD_MS = 300;

type LiveRoomSummaryRow = {
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
  categorySlug: string;
  categoryName: string;
  roundId: string | null;
  roundNumber: number | null;
  roundStatus: string | null;
  roundLocksAt: Date | null;
  roundLockedAt: Date | null;
  roundDrawingAt: Date | null;
  roundSpinningAt: Date | null;
  roundSettlingAt: Date | null;
  roundWinnerEntryId: string | null;
  roundCompletedAt: Date | null;
  roundCancelledAt: Date | null;
  roundTotalEntryAmount: bigint | null;
  roundHouseFeeAmount: bigint | null;
  roundPayoutAmount: bigint | null;
  roundPlatformFeeBps: number | null;
  entryCount: number | null;
  playerCount: number | null;
  liveEntryAmount: bigint | null;
};

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  private readonly liveSummaryCacheByCategory = new Map<
    string,
    {
      snapshot: Awaited<
        ReturnType<RoomsService['buildLiveRoomSummariesForCategory']>
      >;
      expiresAt: number;
      staleUntil: number;
    }
  >();

  private readonly inFlightLiveSummaryByCategory = new Map<
    string,
    Promise<
      Awaited<ReturnType<RoomsService['buildLiveRoomSummariesForCategory']>>
    >
  >();

  private readonly categorySlugByRoomId = new Map<string, string | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
  ) {}

  async findActiveByCategorySlug(categorySlug: string) {
    const startedAt = Date.now();

    if (!categorySlug) {
      throw new BadRequestException('categorySlug is required.');
    }

    const cacheKey = categorySlug.trim();
    const cached = this.liveSummaryCacheByCategory.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      const snapshot = this.rebaseLiveRoomSummarySnapshot(cached.snapshot);

      this.logLiveSummaryTiming(cacheKey, {
        source: 'cache',
        totalMs: Date.now() - startedAt,
        roomCount: snapshot.length,
      });

      return snapshot;
    }

    if (cached && cached.staleUntil > now) {
      const snapshot = this.rebaseLiveRoomSummarySnapshot(cached.snapshot);

      if (!this.hasOverdueOpenRound(snapshot)) {
        this.refreshLiveRoomSummariesForCategoryInBackground(cacheKey);
      }

      this.logLiveSummaryTiming(cacheKey, {
        source: 'stale-cache',
        totalMs: Date.now() - startedAt,
        roomCount: snapshot.length,
      });

      return snapshot;
    }

    if (cached) {
      this.liveSummaryCacheByCategory.delete(cacheKey);
    }

    const existing = this.inFlightLiveSummaryByCategory.get(cacheKey);

    if (existing) {
      const waitStartedAt = Date.now();
      const snapshot = await existing;

      this.logLiveSummaryTiming(cacheKey, {
        source: 'in-flight',
        totalMs: Date.now() - startedAt,
        inFlightWaitMs: Date.now() - waitStartedAt,
        roomCount: snapshot.length,
      });

      return snapshot;
    }

    const request = this.buildLiveRoomSummariesForCategory(cacheKey).finally(
      () => {
        if (this.inFlightLiveSummaryByCategory.get(cacheKey) === request) {
          this.inFlightLiveSummaryByCategory.delete(cacheKey);
        }
      },
    );

    this.inFlightLiveSummaryByCategory.set(cacheKey, request);

    const snapshot = await request;

    this.logLiveSummaryTiming(cacheKey, {
      source: 'db',
      totalMs: Date.now() - startedAt,
      roomCount: snapshot.length,
    });

    return snapshot;
  }

  private async buildLiveRoomSummariesForCategory(categorySlug: string) {
    const queryStartedAt = Date.now();
    const rows = await this.queryLiveRoomSummaryRows(categorySlug);
    const queryMs = Date.now() - queryStartedAt;

    const serializeStartedAt = Date.now();
    const snapshot = this.serializeLiveRoomSummaryRows(rows);
    const serializeMs = Date.now() - serializeStartedAt;

    this.liveSummaryCacheByCategory.set(categorySlug, {
      snapshot,
      expiresAt: Date.now() + LIVE_ROOM_SUMMARY_CACHE_TTL_MS,
      staleUntil: Date.now() + LIVE_ROOM_SUMMARY_STALE_TTL_MS,
    });

    this.logLiveSummaryTiming(categorySlug, {
      source: 'build',
      totalMs: queryMs + serializeMs,
      dbQueryMs: queryMs,
      serializeMs,
      rowCount: rows.length,
      roomCount: snapshot.length,
    });

    return snapshot;
  }

  invalidateLiveRoomSummariesForCategory(categorySlug: string) {
    this.liveSummaryCacheByCategory.delete(categorySlug.trim());
  }

  patchLiveRoomSummaryCacheWithOpenRound(roomId: string, round: RoundSnapshot) {
    if (!roomId || !round || round.status !== RoundStatus.OPEN) {
      return false;
    }

    const serverNow = new Date();
    const now = Date.now();
    let patched = false;

    for (const [categorySlug, cached] of this.liveSummaryCacheByCategory) {
      let categoryChanged = false;

      const snapshot = cached.snapshot.map((room) => {
        if (room.id !== roomId) {
          return room;
        }

        categoryChanged = true;
        patched = true;
        this.categorySlugByRoomId.set(roomId, room.categorySlug);

        return {
          ...room,
          serverNow: serverNow.toISOString(),
          currentRound: this.toOpenLiveRoundSummary(round, serverNow),
        };
      });

      if (categoryChanged) {
        this.liveSummaryCacheByCategory.set(categorySlug, {
          snapshot,
          expiresAt: now + LIVE_ROOM_SUMMARY_CACHE_TTL_MS,
          staleUntil: now + LIVE_ROOM_SUMMARY_STALE_TTL_MS,
        });
      }
    }

    return patched;
  }

  private refreshLiveRoomSummariesForCategoryInBackground(
    categorySlug: string,
  ) {
    if (this.inFlightLiveSummaryByCategory.has(categorySlug)) {
      return;
    }

    const request = this.buildLiveRoomSummariesForCategory(
      categorySlug,
    ).finally(() => {
      if (this.inFlightLiveSummaryByCategory.get(categorySlug) === request) {
        this.inFlightLiveSummaryByCategory.delete(categorySlug);
      }
    });

    this.inFlightLiveSummaryByCategory.set(categorySlug, request);

    void request.catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown summary refresh error';

      this.logger.warn(
        `Background live summary refresh failed for ${categorySlug}: ${message}`,
      );
    });
  }

  private logLiveSummaryTiming(
    categorySlug: string,
    details: {
      source: 'cache' | 'stale-cache' | 'in-flight' | 'db' | 'build';
      totalMs: number;
      dbQueryMs?: number;
      serializeMs?: number;
      inFlightWaitMs?: number;
      rowCount?: number;
      roomCount?: number;
    },
  ) {
    if (details.totalMs < LIVE_ROOM_SUMMARY_TIMING_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[live-summary-timing:${categorySlug}] source=${details.source} total=${details.totalMs}ms dbQuery=${details.dbQueryMs ?? 'n/a'}ms serialize=${details.serializeMs ?? 'n/a'}ms inFlightWait=${details.inFlightWaitMs ?? 0}ms rows=${details.rowCount ?? 'n/a'} rooms=${details.roomCount ?? 'n/a'} dbWaitMayBeIncluded=true`,
    );
  }

  private rebaseLiveRoomSummarySnapshot(
    snapshot: Awaited<
      ReturnType<RoomsService['buildLiveRoomSummariesForCategory']>
    >,
  ) {
    const serverNow = new Date();
    const serverNowMs = serverNow.getTime();

    return snapshot.map((room) => {
      const previousServerNowMs = Date.parse(room.serverNow);
      const elapsedMs = Number.isFinite(previousServerNowMs)
        ? Math.max(0, serverNowMs - previousServerNowMs)
        : 0;
      const currentRound = room.currentRound ? { ...room.currentRound } : null;

      if (currentRound) {
        if (currentRound.status === RoundStatus.OPEN) {
          const locksAtMs = currentRound.locksAt
            ? Date.parse(currentRound.locksAt)
            : NaN;
          const msUntilLock = Number.isFinite(locksAtMs)
            ? Math.max(0, locksAtMs - serverNowMs)
            : Math.max(0, currentRound.msUntilLock - elapsedMs);

          currentRound.msUntilLock = msUntilLock;
          currentRound.msUntilPhaseEnd = msUntilLock;
          currentRound.phaseLabel = 'ENTRY OPEN';
        } else {
          currentRound.msUntilLock = 0;
          currentRound.msUntilPhaseEnd = Math.max(
            0,
            currentRound.msUntilPhaseEnd - elapsedMs,
          );
        }

        if (currentRound.msUntilNextRound !== null) {
          currentRound.msUntilNextRound = Math.max(
            0,
            currentRound.msUntilNextRound - elapsedMs,
          );
        }
      }

      return {
        ...room,
        serverNow: serverNow.toISOString(),
        currentRound,
      };
    });
  }

  private hasOverdueOpenRound(
    snapshot: Awaited<
      ReturnType<RoomsService['buildLiveRoomSummariesForCategory']>
    >,
  ) {
    return snapshot.some(
      (room) =>
        room.status === RoomStatus.ACTIVE &&
        room.isPermanent === true &&
        room.currentRound?.status === RoundStatus.OPEN &&
        room.currentRound.msUntilLock <= 0,
    );
  }

  async findCategorySlugForRoom(roomId: string) {
    if (this.categorySlugByRoomId.has(roomId)) {
      return this.categorySlugByRoomId.get(roomId) ?? null;
    }

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        category: {
          select: {
            slug: true,
          },
        },
      },
    });

    const categorySlug = room?.category.slug ?? null;
    this.categorySlugByRoomId.set(roomId, categorySlug);

    return categorySlug;
  }

  private async queryLiveRoomSummaryRows(categorySlug: string) {
    const activeStatuses = Prisma.join(
      ACTIVE_ROUND_STATUSES.map(
        (status) => Prisma.sql`CAST(${status} AS "RoundStatus")`,
      ),
    );

    const publicSummaryStatuses = Prisma.join(
      PUBLIC_SUMMARY_ROUND_STATUSES.map(
        (status) => Prisma.sql`CAST(${status} AS "RoundStatus")`,
      ),
    );

    const completedVisibleSince = new Date(
      Date.now() - COMPLETED_ROUND_VISIBILITY_MS,
    );
    const cancelledVisibleSince = new Date(
      Date.now() - CANCELLED_ROUND_VISIBILITY_MS,
    );

    return this.prisma.$queryRaw<LiveRoomSummaryRow[]>(Prisma.sql`
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
        c.slug AS "categorySlug",
        c.name AS "categoryName",
        cr.id AS "roundId",
        cr."roundNumber" AS "roundNumber",
        cr.status::text AS "roundStatus",
        cr."locksAt" AS "roundLocksAt",
        cr."lockedAt" AS "roundLockedAt",
        cr."drawingAt" AS "roundDrawingAt",
        cr."spinningAt" AS "roundSpinningAt",
        cr."settlingAt" AS "roundSettlingAt",
        cr."winnerEntryId" AS "roundWinnerEntryId",
        cr."completedAt" AS "roundCompletedAt",
        cr."cancelledAt" AS "roundCancelledAt",
        cr."totalEntryAmount" AS "roundTotalEntryAmount",
        cr."houseFeeAmount" AS "roundHouseFeeAmount",
        cr."payoutAmount" AS "roundPayoutAmount",
        cr."platformFeeBps" AS "roundPlatformFeeBps",
        entry_stats."entryCount" AS "entryCount",
        entry_stats."playerCount" AS "playerCount",
        entry_stats."liveEntryAmount" AS "liveEntryAmount"
      FROM rooms r
      JOIN categories c ON c.id = r."categoryId"
      LEFT JOIN LATERAL (
        SELECT
          ro.id,
          ro."roundNumber",
          ro.status,
          ro."locksAt",
          ro."lockedAt",
          ro."drawingAt",
          ro."spinningAt",
          ro."settlingAt",
          ro."winnerEntryId",
          ro."completedAt",
          ro."cancelledAt",
          ro."totalEntryAmount",
          ro."houseFeeAmount",
          ro."payoutAmount",
          ro."platformFeeBps"
        FROM rounds ro
        WHERE ro."roomId" = r.id
          AND ro.status IN (${publicSummaryStatuses})
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
              r."isPermanent" = true
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
      LEFT JOIN LATERAL (
        SELECT
          COUNT(e.id)::int AS "entryCount",
          COUNT(DISTINCT e."userId")::int AS "playerCount",
          COALESCE(SUM(e.amount), 0)::bigint AS "liveEntryAmount"
        FROM entries e
        WHERE e."roundId" = cr.id
      ) entry_stats ON true
      WHERE c.slug = ${categorySlug}
        AND c."isActive" = true
        AND r.status = CAST(${RoomStatus.ACTIVE} AS "RoomStatus")
      ORDER BY r."isPermanent" DESC, r.code ASC
    `);
  }

  private serializeLiveRoomSummaryRows(rows: LiveRoomSummaryRow[]) {
    const serverNow = new Date();

    return rows.map((row) => {
      this.categorySlugByRoomId.set(row.roomId, row.categorySlug);

      const roundStatus = row.roundStatus as RoundStatus | null;
      const entryCount = row.entryCount ?? 0;
      const playerCount = row.playerCount ?? 0;
      const liveEntryAmount = row.liveEntryAmount ?? 0n;

      const totalEntryAmount =
        roundStatus === RoundStatus.OPEN
          ? liveEntryAmount
          : (row.roundTotalEntryAmount ?? liveEntryAmount);

      const platformFeeBps =
        row.roundPlatformFeeBps ??
        (roundStatus === RoundStatus.OPEN
          ? getApiEnv().PLATFORM_FEE_BPS
          : 0);

      const platformFeeAmount =
        roundStatus === RoundStatus.OPEN
          ? (totalEntryAmount * BigInt(platformFeeBps)) / 10_000n
          : (row.roundHouseFeeAmount ?? 0n);

      const payoutAmount =
        roundStatus === RoundStatus.OPEN
          ? totalEntryAmount - platformFeeAmount
          : (row.roundPayoutAmount ?? totalEntryAmount);

      const msUntilLock =
        roundStatus === RoundStatus.OPEN && row.roundLocksAt
          ? Math.max(0, row.roundLocksAt.getTime() - serverNow.getTime())
          : 0;

      const publicRoundView = buildPublicRoundPhaseView(
        {
          status: roundStatus,
          locksAt: row.roundLocksAt,
          lockedAt: row.roundLockedAt,
          drawingAt: row.roundDrawingAt,
          spinningAt: row.roundSpinningAt,
          settlingAt: row.roundSettlingAt,
          completedAt: row.roundCompletedAt,
          cancelledAt: row.roundCancelledAt,
          winnerEntryId: row.roundWinnerEntryId,
          entryCount,
        },
        serverNow,
      );

      return {
        id: row.roomId,
        categoryId: row.roomCategoryId,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        code: row.roomCode,
        name: row.roomName,
        status: row.roomStatus,
        gameMode: row.roomGameMode,
        fixedEntryAmount: row.roomFixedEntryAmount?.toString() ?? null,
        isPermanent: row.roomIsPermanent,
        maxPlayers: row.roomMaxPlayers,
        roundDurationMs: row.roomRoundDurationMs,
        activatedAt: row.roomActivatedAt?.toISOString() ?? null,
        serverNow: serverNow.toISOString(),
        currentRound: row.roundId
          ? {
              id: row.roundId,
              roundNumber: row.roundNumber ?? 0,
              status: roundStatus,
              phase: publicRoundView.phase,
              phaseLabel: publicRoundView.phaseLabel,
              locksAt: row.roundLocksAt?.toISOString() ?? null,
              msUntilLock,
              msUntilPhaseEnd: publicRoundView.msUntilPhaseEnd,
              msUntilNextRound: publicRoundView.msUntilNextRound,
              resultReason: publicRoundView.resultReason,
              playerCount,
              entryCount,
              totalEntryAmount: totalEntryAmount.toString(),
              payoutAmount: payoutAmount.toString(),
              totalPool: totalEntryAmount.toString(),
              grossPoolAmount: totalEntryAmount.toString(),
              platformFeeAmount: platformFeeAmount.toString(),
              netPrizeAmount: payoutAmount.toString(),
              platformFeeBps,
              winnerEntryId:
                roundStatus === RoundStatus.SETTLING ||
                roundStatus === RoundStatus.COMPLETED
                  ? row.roundWinnerEntryId
                  : null,
            }
          : null,
      };
    });
  }

  private toOpenLiveRoundSummary(round: RoundSnapshot, serverNow: Date) {
    const locksAt = this.parseNullableDate(round.locksAt);

    const publicRoundView = buildPublicRoundPhaseView(
      {
        status: RoundStatus.OPEN,
        locksAt,
        lockedAt: null,
        drawingAt: null,
        spinningAt: null,
        settlingAt: null,
        completedAt: null,
        cancelledAt: null,
        winnerEntryId: null,
        entryCount: 0,
      },
      serverNow,
    );

    const msUntilLock = locksAt
      ? Math.max(0, locksAt.getTime() - serverNow.getTime())
      : 0;

    return {
      id: round.id,
      roundNumber: round.roundNumber,
      status: RoundStatus.OPEN,
      phase: publicRoundView.phase,
      phaseLabel: publicRoundView.phaseLabel,
      locksAt: round.locksAt,
      msUntilLock,
      msUntilPhaseEnd: publicRoundView.msUntilPhaseEnd,
      msUntilNextRound: publicRoundView.msUntilNextRound,
      resultReason: publicRoundView.resultReason,
      playerCount: 0,
      entryCount: 0,
      totalEntryAmount: '0',
      payoutAmount: '0',
      totalPool: '0',
      grossPoolAmount: '0',
      platformFeeAmount: '0',
      netPrizeAmount: '0',
      platformFeeBps: round.platformFeeBps,
      winnerEntryId: null,
    };
  }

  private parseNullableDate(value: string | null) {
    return value ? new Date(value) : null;
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

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId: room.id,
        status: { in: ACTIVE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: 'desc' },
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
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];

    return {
      serverNow: new Date().toISOString(),

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

      currentRound: currentRound
        ? this.roundsService.toLiveRoundSnapshot(currentRound, entries.length)
        : null,

   entries: entries.map((entry) => ({
  id: entry.id,
  roundId: entry.roundId,
  userId: entry.userId,
  amount: entry.amount.toString(),
  ticketStart: entry.ticketStart?.toString() ?? null,
  ticketEnd: entry.ticketEnd?.toString() ?? null,
  isWinner: entry.isWinner,
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
  player: entry.user
    ? {
        id: entry.user.id,
        username: entry.user.username,
        fullName: entry.user.fullName,
      }
    : null,
})),
    };
  }
}