import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoomStatus, RoundStatus } from '@kingspin/db';
import { PrismaService } from '../../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';

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
  roundId: string | null;
  roundNumber: number | null;
  roundStatus: string | null;
  roundLocksAt: Date | null;
  roundTotalEntryAmount: bigint | null;
  roundPayoutAmount: bigint | null;
  entryCount: number | null;
  playerCount: number | null;
  liveEntryAmount: bigint | null;
};

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

    const rows = await this.queryLiveRoomSummaryRows(categorySlug);

    return this.serializeLiveRoomSummaryRows(rows);
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
        cr.id AS "roundId",
        cr."roundNumber" AS "roundNumber",
        cr.status::text AS "roundStatus",
        cr."locksAt" AS "roundLocksAt",
        cr."totalEntryAmount" AS "roundTotalEntryAmount",
        cr."payoutAmount" AS "roundPayoutAmount",
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
          ro."totalEntryAmount",
          ro."payoutAmount"
        FROM rounds ro
        WHERE ro."roomId" = r.id
          AND ro.status IN (${publicSummaryStatuses})
        ORDER BY
          CASE WHEN ro.status IN (${activeStatuses}) THEN 0 ELSE 1 END,
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
      const roundStatus = row.roundStatus as RoundStatus | null;
      const entryCount = row.entryCount ?? 0;
      const playerCount = row.playerCount ?? 0;
      const liveEntryAmount = row.liveEntryAmount ?? 0n;
      const totalEntryAmount =
        roundStatus === RoundStatus.OPEN
          ? liveEntryAmount
          : row.roundTotalEntryAmount ?? liveEntryAmount;
      const payoutAmount =
        roundStatus === RoundStatus.OPEN
          ? liveEntryAmount
          : row.roundPayoutAmount ?? totalEntryAmount;
      const msUntilLock =
        roundStatus === RoundStatus.OPEN && row.roundLocksAt
          ? Math.max(0, row.roundLocksAt.getTime() - serverNow.getTime())
          : 0;

      return {
        id: row.roomId,
        categoryId: row.roomCategoryId,
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
              locksAt: row.roundLocksAt?.toISOString() ?? null,
              msUntilLock,
              playerCount,
              entryCount,
              totalEntryAmount: totalEntryAmount.toString(),
              payoutAmount: payoutAmount.toString(),
              totalPool: payoutAmount.toString(),
            }
          : null,
      };
    });
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
