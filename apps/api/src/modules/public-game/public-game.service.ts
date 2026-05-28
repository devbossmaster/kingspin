import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoundStatus } from "@kingspin/db";
import { PrismaService } from "../../prisma/prisma.service";

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

type RoomLiveStateSnapshot = {
  serverNow: string;
  room: {
    id: string;
    categoryId: string;
    code: string;
    name: string;
    status: string;
    isPermanent: boolean;
    maxPlayers: number;
    roundDurationMs: number;
    activatedAt: string | null;
  };
  category: {
    id: string;
    name: string;
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
    serverSeedHash: string;
    winningTicket: string | null;
    winnerUserId: string | null;
    winnerEntryId: string | null;
    spinAngle: number | null;
    msUntilLock: number;
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

@Injectable()
export class PublicGameService {
  private readonly inFlightLiveStateByRoom = new Map<
    string,
    Promise<RoomLiveStateSnapshot>
  >();

  constructor(private readonly prisma: PrismaService) {}

  async getRoomLiveState(roomId: string): Promise<RoomLiveStateSnapshot> {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    /**
     * Performance fix:
     *
     * This endpoint is called by normal page refreshes and by socket broadcasts.
     * If several callers ask for the same room at the same time, they should not
     * all hit Supabase independently.
     *
     * This is not stale caching. It only dedupes concurrent in-flight work, so a
     * later request still gets fresh DB state.
     */
    const existingInFlight = this.inFlightLiveStateByRoom.get(roomId);

    if (existingInFlight) {
      return existingInFlight;
    }

    const request = this.buildRoomLiveState(roomId).finally(() => {
      this.inFlightLiveStateByRoom.delete(roomId);
    });

    this.inFlightLiveStateByRoom.set(roomId, request);

    return request;
  }

  private async buildRoomLiveState(
    roomId: string,
  ): Promise<RoomLiveStateSnapshot> {
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
      throw new NotFoundException("Room not found.");
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

    const msUntilLock =
      currentRound?.status === RoundStatus.OPEN && currentRound.locksAt
        ? Math.max(0, currentRound.locksAt.getTime() - serverNow.getTime())
        : 0;

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
        ? {
            id: currentRound.id,
            roomId: currentRound.roomId,
            roundNumber: currentRound.roundNumber,
            status: currentRound.status,
            totalEntryAmount: currentRound.totalEntryAmount.toString(),
            houseFeeAmount: currentRound.houseFeeAmount.toString(),
            payoutAmount: currentRound.payoutAmount.toString(),
            openedAt: currentRound.openedAt.toISOString(),
            locksAt: currentRound.locksAt?.toISOString() ?? null,
            lockedAt: currentRound.lockedAt?.toISOString() ?? null,
            drawingAt: currentRound.drawingAt?.toISOString() ?? null,
            spinningAt: currentRound.spinningAt?.toISOString() ?? null,
            settlingAt: currentRound.settlingAt?.toISOString() ?? null,
            completedAt: currentRound.completedAt?.toISOString() ?? null,
            cancelledAt: currentRound.cancelledAt?.toISOString() ?? null,

            // Safe to expose before draw.
            serverSeedHash: currentRound.serverSeedHash,

            // Do NOT expose serverSeedReveal here.
            winningTicket: currentRound.winningTicket?.toString() ?? null,
            winnerUserId: currentRound.winnerUserId,
            winnerEntryId: currentRound.winnerEntryId,
            spinAngle: currentRound.spinAngle,
            msUntilLock,
          }
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
}
