import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoundStatus, type Round } from "@kingspin/db";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { WalletsService, type EntryRefundResult } from "../wallets/wallets.service";

const ACTIVE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

const CANCELLABLE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

export type RoundSnapshot = {
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
  serverSeedHash: string | null;
  winningTicket: string | null;
  winnerUserId: string | null;
  winnerEntryId: string | null;
  spinAngle: number | null;
};

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
  ) {}

  async startOpenRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const round = await this.prisma.$transaction(async (tx) => {
      const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${roomId})) AS locked
      `;

      const hasLock = lockResult[0]?.locked === true;

      if (!hasLock) {
        throw new ConflictException(
          "Another round start is already running for this room.",
        );
      }

      const room = await tx.room.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          status: true,
          roundDurationMs: true,
        },
      });

      if (!room) {
        throw new NotFoundException("Room not found.");
      }

      if (room.status !== "ACTIVE") {
        throw new BadRequestException("Only ACTIVE rooms can start rounds.");
      }

      const existingCurrentRound = await tx.round.findFirst({
        where: {
          roomId,
          status: { in: ACTIVE_ROUND_STATUSES },
        },
        orderBy: { roundNumber: "desc" },
      });

      if (existingCurrentRound) {
        return existingCurrentRound;
      }

      const latestRound = await tx.round.findFirst({
        where: { roomId },
        orderBy: { roundNumber: "desc" },
        select: { roundNumber: true },
      });

      const roundNumber = (latestRound?.roundNumber ?? 0) + 1;
      const openedAt = new Date();
      const locksAt = new Date(openedAt.getTime() + room.roundDurationMs);

      const serverSeed = randomBytes(32).toString("hex");
      const serverSeedHash = createHash("sha256")
        .update(serverSeed)
        .digest("hex");

      return tx.round.create({
        data: {
          roomId,
          roundNumber,
          status: RoundStatus.OPEN,
          openedAt,
          locksAt,
          serverSeedHash,
          serverSeedReveal: serverSeed,
          idempotencyKey: `round:start:${roomId}:${roundNumber}`,
        },
      });
    });

    return this.toRoundSnapshot(round);
  }

  async findCurrentRoundForRoom(roomId: string): Promise<RoundSnapshot | null> {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const round = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: ACTIVE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: "desc" },
    });

    return round ? this.toRoundSnapshot(round) : null;
  }

  async lockCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: RoundStatus.OPEN,
      },
      orderBy: { roundNumber: "desc" },
    });

    if (!currentRound) {
      throw new BadRequestException("Room does not have an OPEN round to lock.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const lockResult = await tx.round.updateMany({
        where: {
          id: currentRound.id,
          status: RoundStatus.OPEN,
        },
        data: {
          status: RoundStatus.LOCKED,
          lockedAt: new Date(),
        },
      });

      if (lockResult.count !== 1) {
        throw new BadRequestException("Round is no longer OPEN.");
      }

      const entries = await tx.entry.findMany({
        where: { roundId: currentRound.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      if (entries.length === 0) {
        throw new BadRequestException("Cannot lock a round with no entries.");
      }

      let cursor = 0n;

      for (const entry of entries) {
        const ticketStart = cursor;
        const ticketEnd = cursor + entry.amount - 1n;

        await tx.entry.update({
          where: { id: entry.id },
          data: {
            ticketStart,
            ticketEnd,
          },
        });

        cursor = ticketEnd + 1n;
      }

      const finalRound = await tx.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      if (cursor !== finalRound.totalEntryAmount) {
        throw new BadRequestException(
          "Ticket assignment mismatch. Round total does not equal assigned tickets.",
        );
      }

      const finalEntries = await tx.entry.findMany({
        where: { roundId: currentRound.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      return {
        round: finalRound,
        entries: finalEntries,
      };
    });

    return {
      currentRound: this.toRoundSnapshot(result.round),
      entries: result.entries.map((entry) => ({
        id: entry.id,
        roundId: entry.roundId,
        userId: entry.userId,
        amount: entry.amount.toString(),
        ticketStart: entry.ticketStart?.toString() ?? null,
        ticketEnd: entry.ticketEnd?.toString() ?? null,
        isWinner: entry.isWinner,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
    };
  }

  async cancelCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: CANCELLABLE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: "desc" },
    });

    if (!currentRound) {
      throw new BadRequestException("Room does not have a cancellable round.");
    }

    // If the round is still OPEN, stop new entries first.
    // We use LOCKED as a temporary "no more entries" state before final CANCELLED.
    if (currentRound.status === RoundStatus.OPEN) {
      const stopEntryResult = await this.prisma.round.updateMany({
        where: {
          id: currentRound.id,
          status: RoundStatus.OPEN,
        },
        data: {
          status: RoundStatus.LOCKED,
          lockedAt: new Date(),
        },
      });

      if (stopEntryResult.count !== 1) {
        throw new BadRequestException(
          "Round changed while cancellation was starting. Retry cancel.",
        );
      }
    }

    const entries = await this.prisma.entry.findMany({
      where: { roundId: currentRound.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const refundResults: EntryRefundResult[] = [];

    for (const entry of entries) {
      const refundResult = await this.walletsService.refundEntryHoldsByEntryId({
        roundId: currentRound.id,
        entryId: entry.id,
      });

      refundResults.push(refundResult);
    }

    const cancelResult = await this.prisma.round.updateMany({
      where: {
        id: currentRound.id,
        status: { in: CANCELLABLE_ROUND_STATUSES },
      },
      data: {
        status: RoundStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    if (cancelResult.count !== 1) {
      const round = await this.prisma.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      if (round.status !== RoundStatus.CANCELLED) {
        throw new BadRequestException(
          "Round could not be marked CANCELLED. Manual review required.",
        );
      }
    }

    const cancelledRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: currentRound.id },
    });

    const refundedCount = refundResults.filter((result) => result.refunded).length;
    const skippedCount = refundResults.filter(
      (result) => result.reason === "NO_HOLD_FOUND",
    ).length;
    const alreadyRefundedCount = refundResults.filter(
      (result) => result.reason === "ALREADY_REFUNDED",
    ).length;
    const refundedAmount = refundResults.reduce(
      (sum, result) => sum + result.amount,
      0n,
    );

    return {
      currentRound: this.toRoundSnapshot(cancelledRound),
      refundedCount,
      skippedCount,
      alreadyRefundedCount,
      refundedAmount: refundedAmount.toString(),
      refundResults: refundResults.map((refund) => ({
        entryId: refund.entryId,
        refunded: refund.refunded,
        amount: refund.amount.toString(),
        reason: refund.reason,
      })),
    };
  }
  toRoundSnapshot(round: Round): RoundSnapshot {
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
}




