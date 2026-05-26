import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { RoundStatus } from "@kingspin/db";
import { PrismaService } from "../../prisma/prisma.service";

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

@Injectable()
export class PublicGameService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoomLiveState(roomId: string) {
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
