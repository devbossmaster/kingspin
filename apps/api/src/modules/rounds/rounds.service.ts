import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoundStatus, type Entry, type Round } from "@kingspin/db";
import { createHash, randomBytes } from "node:crypto";
import {
  calculateSpinAngle as calculateGameSpinAngle,
  selectWinner,
  verifyTicketRanges,
  type TicketRange,
} from "@kingspin/game-engine";
import { PrismaService } from "../../prisma/prisma.service";
import {
  WalletsService,
  type EntryRefundResult,
} from "../wallets/wallets.service";

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

type EntrySnapshot = {
  id: string;
  roundId: string;
  userId: string;
  amount: string;
  ticketStart: string | null;
  ticketEnd: string | null;
  isWinner: boolean;
  createdAt: string;
  updatedAt: string;
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
      entries: result.entries.map((entry) => this.toEntrySnapshot(entry)),
    };
  }

  async drawCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: [RoundStatus.LOCKED, RoundStatus.DRAWING] },
      },
      orderBy: { roundNumber: "desc" },
    });

    if (!currentRound) {
      throw new BadRequestException(
        "Room does not have a LOCKED round ready to draw.",
      );
    }

    const entries = await this.prisma.entry.findMany({
      where: { roundId: currentRound.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (entries.length === 0) {
      throw new BadRequestException("Cannot draw a round with no entries.");
    }

    if (currentRound.totalEntryAmount <= 0n) {
      throw new BadRequestException("Cannot draw a round with zero total.");
    }

    const invalidRangeEntry = entries.find(
      (entry) => entry.ticketStart === null || entry.ticketEnd === null,
    );

    if (invalidRangeEntry) {
      throw new BadRequestException(
        "Cannot draw before ticket ranges are assigned. Lock the round first.",
      );
    }

    if (!currentRound.serverSeedReveal) {
      throw new BadRequestException(
        "Round is missing server seed reveal. Cannot draw safely.",
      );
    }

    if (
      currentRound.status === RoundStatus.DRAWING &&
      currentRound.winningTicket !== null &&
      currentRound.winnerEntryId
    ) {
      const winnerEntry = entries.find(
        (entry) => entry.id === currentRound.winnerEntryId,
      );

      return {
        currentRound: this.toRoundSnapshot(currentRound),
        winningTicket: currentRound.winningTicket.toString(),
        winnerEntry: winnerEntry
        ? this.toEntryWithPlayerSnapshot(winnerEntry)
        : null,
        entries: entries.map((entry) => this.toEntryWithPlayerSnapshot(entry)),
        reused: true,
      };
    }

    const ticketRanges = this.toTicketRangesFromEntries(entries);

    const winnerSelection = selectWinner({
      ranges: ticketRanges,
      serverSeed: currentRound.serverSeedReveal,
      roundId: currentRound.id,
      roundNumber: currentRound.roundNumber,
      totalEntryAmount: currentRound.totalEntryAmount,
    });

    const winningTicket = winnerSelection.winningTicket;

    const winnerEntry = entries.find(
      (entry) => entry.id === winnerSelection.winnerRange.id,
    );

    if (!winnerEntry) {
      throw new BadRequestException(
        "Winning ticket did not match any entry. Manual review required.",
      );
    }

    const spinAngle = this.calculateSpinAngle(
      winningTicket,
      currentRound.totalEntryAmount,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.round.updateMany({
        where: {
          id: currentRound.id,
          status: RoundStatus.LOCKED,
        },
        data: {
          status: RoundStatus.DRAWING,
          drawingAt: new Date(),
          winningTicket,
          winnerEntryId: winnerEntry.id,
          winnerUserId: winnerEntry.userId,
          spinAngle,
        },
      });

      if (updateResult.count !== 1) {
        const racedRound = await tx.round.findUniqueOrThrow({
          where: { id: currentRound.id },
        });

        if (
          racedRound.status === RoundStatus.DRAWING &&
          racedRound.winningTicket !== null &&
          racedRound.winnerEntryId
        ) {
          return {
            round: racedRound,
            winnerEntry,
            entries,
            reused: true,
          };
        }

        throw new BadRequestException(
          "Round changed while drawing. Retry or review manually.",
        );
      }

      await tx.entry.update({
        where: { id: winnerEntry.id },
        data: { isWinner: true },
      });

      const finalRound = await tx.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      const finalEntries = await tx.entry.findMany({
        where: { roundId: currentRound.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      const finalWinnerEntry = finalEntries.find(
        (entry) => entry.id === winnerEntry.id,
      );

      if (!finalWinnerEntry) {
        throw new BadRequestException("Winner entry disappeared after draw.");
      }

      return {
        round: finalRound,
        winnerEntry: finalWinnerEntry,
        entries: finalEntries,
        reused: false,
      };
    });

    return {
      currentRound: this.toRoundSnapshot(result.round),
      winningTicket: result.round.winningTicket?.toString() ?? null,
      winnerEntry: this.toEntrySnapshot(result.winnerEntry),
      entries: result.entries.map((entry) => this.toEntrySnapshot(entry)),
      reused: result.reused,
    };
  }

  async settleCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    let currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: [RoundStatus.DRAWING, RoundStatus.SETTLING] },
      },
      orderBy: { roundNumber: "desc" },
    });

    if (!currentRound) {
      const completedRound = await this.prisma.round.findFirst({
        where: {
          roomId,
          status: RoundStatus.COMPLETED,
          winnerEntryId: { not: null },
          winnerUserId: { not: null },
        },
        orderBy: { roundNumber: "desc" },
      });

      if (completedRound) {
        const completedWinnerEntryId = completedRound.winnerEntryId;

        const winnerEntry = completedWinnerEntryId
          ? await this.prisma.entry.findUnique({
              where: { id: completedWinnerEntryId },
            })
          : null;

        return {
          currentRound: this.toRoundSnapshot(completedRound),
          winnerEntry: winnerEntry
        ? this.toEntryWithPlayerSnapshot(winnerEntry)
        : null,
          payoutAmount: completedRound.payoutAmount.toString(),
          payout: null,
          reused: true,
        };
      }

      throw new BadRequestException(
        "Room does not have a DRAWING round ready to settle.",
      );
    }

    const winnerUserId = currentRound.winnerUserId;
    const winnerEntryId = currentRound.winnerEntryId;

    if (!winnerEntryId || !winnerUserId) {
      throw new BadRequestException(
        "Round has no winner yet. Draw the round before settlement.",
      );
    }

    if (currentRound.payoutAmount <= 0n) {
      throw new BadRequestException("Round payout amount must be greater than zero.");
    }

    const winnerEntry = await this.prisma.entry.findUnique({
      where: { id: winnerEntryId },
    });

    if (!winnerEntry) {
      throw new BadRequestException("Winner entry not found.");
    }

    if (winnerEntry.userId !== winnerUserId) {
      throw new BadRequestException(
        "Winner entry user does not match round winner user. Manual review required.",
      );
    }

    if (currentRound.status === RoundStatus.DRAWING) {
      const settleStart = await this.prisma.round.updateMany({
        where: {
          id: currentRound.id,
          status: RoundStatus.DRAWING,
        },
        data: {
          status: RoundStatus.SETTLING,
          settlingAt: new Date(),
        },
      });

      if (settleStart.count !== 1) {
        currentRound = await this.prisma.round.findUniqueOrThrow({
          where: { id: currentRound.id },
        });

        if (currentRound.status !== RoundStatus.SETTLING) {
          throw new BadRequestException(
            "Round changed while settlement was starting. Retry settlement.",
          );
        }
      } else {
        currentRound = await this.prisma.round.findUniqueOrThrow({
          where: { id: currentRound.id },
        });
      }
    }

    const payout = await this.walletsService.creditRoundWin({
      userId: winnerUserId,
      roundId: currentRound.id,
      winnerEntryId,
      amount: currentRound.payoutAmount,
    });

    const completeResult = await this.prisma.round.updateMany({
      where: {
        id: currentRound.id,
        status: RoundStatus.SETTLING,
      },
      data: {
        status: RoundStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    if (completeResult.count !== 1) {
      const round = await this.prisma.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      if (round.status !== RoundStatus.COMPLETED) {
        throw new BadRequestException(
          "Payout was created but round could not be marked COMPLETED. Retry settlement.",
        );
      }
    }

    const completedRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: currentRound.id },
    });

    const finalWinnerEntry = await this.prisma.entry.findUniqueOrThrow({
      where: { id: winnerEntryId },
    });

    return {
      currentRound: this.toRoundSnapshot(completedRound),
      winnerEntry: this.toEntrySnapshot(finalWinnerEntry),
      payoutAmount: completedRound.payoutAmount.toString(),
      payout,
      reused: payout.reused,
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

  async getLatestRoundResultForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const round = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: RoundStatus.COMPLETED,
      },
      orderBy: { roundNumber: "desc" },
    });

    if (!round) {
      throw new NotFoundException("No completed round result found for this room.");
    }

    const entries = await this.prisma.entry.findMany({
      where: { roundId: round.id },
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
    });

    const winnerEntry = round.winnerEntryId
      ? entries.find((entry) => entry.id === round.winnerEntryId) ?? null
      : null;

    const serverSeedReveal = round.serverSeedReveal;
    const serverSeedHash = round.serverSeedHash;

    const recomputedServerSeedHash = serverSeedReveal
      ? createHash("sha256").update(serverSeedReveal).digest("hex")
      : null;

    const seedHashMatches =
      !!serverSeedReveal &&
      !!serverSeedHash &&
      recomputedServerSeedHash === serverSeedHash;

    const drawInput =
      serverSeedReveal && round.totalEntryAmount > 0n
        ? [
            serverSeedReveal,
            round.id,
            round.roundNumber.toString(),
            round.totalEntryAmount.toString(),
          ].join(":")
        : null;

    const drawHash = drawInput
      ? createHash("sha256").update(drawInput).digest("hex")
      : null;

    const recomputedWinningTicket =
      drawHash && round.totalEntryAmount > 0n
        ? BigInt(`0x${drawHash}`) % round.totalEntryAmount
        : null;

    const winningTicketMatches =
      recomputedWinningTicket !== null &&
      round.winningTicket !== null &&
      recomputedWinningTicket === round.winningTicket;

    const winnerTicketInsideRange =
      !!winnerEntry &&
      round.winningTicket !== null &&
      winnerEntry.ticketStart !== null &&
      winnerEntry.ticketEnd !== null &&
      round.winningTicket >= winnerEntry.ticketStart &&
      round.winningTicket <= winnerEntry.ticketEnd;

    const rangesCheck = this.verifyEntryRanges(entries, round.totalEntryAmount);

    return {
      round: this.toRoundSnapshot(round),
      serverSeedReveal,
      fairness: {
        serverSeedHash,
        recomputedServerSeedHash,
        seedHashMatches,
        drawInput,
        drawHash,
        recomputedWinningTicket: recomputedWinningTicket?.toString() ?? null,
        winningTicketMatches,
        winnerTicketInsideRange,
        rangesCoverTotal: rangesCheck.rangesCoverTotal,
        rangeError: rangesCheck.rangeError,
      },
      winnerEntry: winnerEntry
        ? this.toEntryWithPlayerSnapshot(winnerEntry)
        : null,
      entries: entries.map((entry) => this.toEntryWithPlayerSnapshot(entry)),
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

  private toEntrySnapshot(entry: Entry): EntrySnapshot {
    return {
      id: entry.id,
      roundId: entry.roundId,
      userId: entry.userId,
      amount: entry.amount.toString(),
      ticketStart: entry.ticketStart?.toString() ?? null,
      ticketEnd: entry.ticketEnd?.toString() ?? null,
      isWinner: entry.isWinner,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  private toTicketRangesFromEntries(entries: Entry[]): TicketRange[] {
    return entries.map((entry) => {
      if (entry.ticketStart === null || entry.ticketEnd === null) {
        throw new BadRequestException(
          `Entry ${entry.id} is missing ticket range.`,
        );
      }

      return {
        id: entry.id,
        userId: entry.userId,
        amount: entry.amount,
        ticketStart: entry.ticketStart,
        ticketEnd: entry.ticketEnd,
      };
    });
  }
  private verifyEntryRanges(entries: Entry[], expectedTotal: bigint) {
    return verifyTicketRanges(
      this.toTicketRangesFromEntries(entries),
      expectedTotal,
    );
  }
  private calculateSpinAngle(winningTicket: bigint, totalTickets: bigint) {
    return calculateGameSpinAngle(winningTicket, totalTickets);
  }

  private toEntryWithPlayerSnapshot(entry: {
    id: string;
    roundId: string;
    userId: string;
    amount: bigint;
    ticketStart: bigint | null;
    ticketEnd: bigint | null;
    isWinner: boolean;
    createdAt: Date;
    updatedAt: Date;
    user?: {
      id: string;
      username: string;
      fullName: string | null;
    } | null;
  }) {
    return {
      id: entry.id,
      roundId: entry.roundId,
      userId: entry.userId,
      player: entry.user
        ? {
            id: entry.user.id,
            username: entry.user.username,
            fullName: entry.user.fullName,
          }
        : null,
      amount: entry.amount.toString(),
      ticketStart: entry.ticketStart?.toString() ?? null,
      ticketEnd: entry.ticketEnd?.toString() ?? null,
      isWinner: entry.isWinner,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }
}












