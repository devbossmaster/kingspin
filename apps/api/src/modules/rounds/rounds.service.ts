import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoundStatus, type Entry } from '@kingspin/db';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  calculateSpinAngle as calculateGameSpinAngle,
  selectWinner,
  verifyTicketRanges,
  type TicketRange,
} from '@kingspin/game-engine';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WalletsService,
  type EntryRefundResult,
} from '../wallets/wallets.service';
import { buildPublicRoundPhaseView } from './public-round-phase';
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

const CANCELLABLE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
];

const LATEST_RESULT_TIMING_WARN_THRESHOLD_MS = 1_000;
const ROUND_TRANSACTION_TIMING_WARN_THRESHOLD_MS = 300;

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

export type LiveRoundSnapshot = RoundSnapshot & {
  msUntilLock: number;
  phase: PublicRoundPhase;
  phaseLabel: string;
  msUntilPhaseEnd: number;
  msUntilNextRound: number | null;
  resultReason: PublicRoundResultReason;
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

type RoundSnapshotSource = {
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
};

type TicketRangeEntrySource = {
  id: string;
  userId: string;
  amount: bigint;
  ticketStart: bigint | null;
  ticketEnd: bigint | null;
};

type LatestRoundResultRow = {
  roundId: string;
  roundRoomId: string;
  roundNumber: number;
  roundStatus: string;
  roundOpenedAt: Date;
  roundLocksAt: Date | null;
  roundLockedAt: Date | null;
  roundDrawingAt: Date | null;
  roundSpinningAt: Date | null;
  roundSettlingAt: Date | null;
  roundCompletedAt: Date | null;
  roundCancelledAt: Date | null;
  roundTotalEntryAmount: bigint;
  roundHouseFeeAmount: bigint;
  roundPayoutAmount: bigint;
  roundServerSeedHash: string | null;
  roundServerSeedReveal: string | null;
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

type WinnerFeedScope = 'latest' | 'week' | 'month';

type WinnerFeedRow = {
  roundId: string;
  roomId: string;
  roomCode: string;
  roomName: string | null;
  roomMaxPlayers: number;
  roomGameMode: string;
  categorySlug: string;
  categoryName: string;
  roundNumber: number;
  completedAt: Date | null;
  totalEntryAmount: bigint;
  payoutAmount: bigint;
  winnerUserId: string;
  winnerEntryId: string;
  winnerEntryAmount: bigint | null;
  winnerUsername: string | null;
  playerCount: bigint | number | null;
  entryCount: bigint | number | null;
};

type LatestRoundResultRound = RoundSnapshotSource & {
  serverSeedReveal: string | null;
};

type CancelAndStartTiming = {
  transactionWaitMs: number;
  roomLockMs: number;
  roundLockMs: number;
  findEntriesMs: number;
  refundMs: number;
  cancelMs: number;
  nextRoundMs: number;
};

type EmptyCancelAndStartRow = {
  cancelledId: string;
  cancelledRoomId: string;
  cancelledRoundNumber: number;
  cancelledStatus: RoundStatus;
  cancelledTotalEntryAmount: bigint;
  cancelledHouseFeeAmount: bigint;
  cancelledPayoutAmount: bigint;
  cancelledOpenedAt: Date;
  cancelledLocksAt: Date | null;
  cancelledLockedAt: Date | null;
  cancelledDrawingAt: Date | null;
  cancelledSpinningAt: Date | null;
  cancelledSettlingAt: Date | null;
  cancelledCompletedAt: Date | null;
  cancelledCancelledAt: Date | null;
  cancelledServerSeedHash: string | null;
  cancelledWinningTicket: bigint | null;
  cancelledWinnerUserId: string | null;
  cancelledWinnerEntryId: string | null;
  cancelledSpinAngle: number | null;
  nextId: string;
  nextRoomId: string;
  nextRoundNumber: number;
  nextStatus: RoundStatus;
  nextTotalEntryAmount: bigint;
  nextHouseFeeAmount: bigint;
  nextPayoutAmount: bigint;
  nextOpenedAt: Date;
  nextLocksAt: Date | null;
  nextLockedAt: Date | null;
  nextDrawingAt: Date | null;
  nextSpinningAt: Date | null;
  nextSettlingAt: Date | null;
  nextCompletedAt: Date | null;
  nextCancelledAt: Date | null;
  nextServerSeedHash: string | null;
  nextWinningTicket: bigint | null;
  nextWinnerUserId: string | null;
  nextWinnerEntryId: string | null;
  nextSpinAngle: number | null;
};

@Injectable()
export class RoundsService {
  private readonly logger = new Logger(RoundsService.name);
  private readonly transactionOptions = {
    maxWait: 30_000,
    timeout: 30_000,
  } as const;

  private readonly inFlightLatestResultByRoom = new Map<
    string,
    Promise<Awaited<ReturnType<RoundsService['buildLatestRoundResultForRoom']>>>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
  ) {}

  async startOpenRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const round = await this.prisma.$transaction(async (tx) => {
      const lockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${roomId})) AS locked
      `;

      const hasLock = lockResult[0]?.locked === true;

      if (!hasLock) {
        throw new ConflictException(
          'Another round start is already running for this room.',
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
        throw new NotFoundException('Room not found.');
      }

      if (room.status !== 'ACTIVE') {
        throw new BadRequestException('Only ACTIVE rooms can start rounds.');
      }

      const existingCurrentRound = await tx.round.findFirst({
        where: {
          roomId,
          status: { in: ACTIVE_ROUND_STATUSES },
        },
        orderBy: { roundNumber: 'desc' },
      });

      if (existingCurrentRound) {
        return existingCurrentRound;
      }

      const latestRound = await tx.round.findFirst({
        where: { roomId },
        orderBy: { roundNumber: 'desc' },
        select: { roundNumber: true },
      });

      return this.createOpenRoundForRoomTx(tx, {
        roomId,
        roundDurationMs: room.roundDurationMs,
        latestRoundNumber: latestRound?.roundNumber ?? 0,
      });
    }, this.transactionOptions);

    return this.toRoundSnapshot(round);
  }

  async findCurrentRoundForRoom(roomId: string): Promise<RoundSnapshot | null> {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const round = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: ACTIVE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: 'desc' },
    });

    return round ? this.toRoundSnapshot(round) : null;
  }

  private createOpenRoundForRoomTx(
    tx: Prisma.TransactionClient,
    args: {
      roomId: string;
      roundDurationMs: number;
      latestRoundNumber: number;
    },
  ) {
    const roundNumber = args.latestRoundNumber + 1;
    const openedAt = new Date();
    const locksAt = new Date(openedAt.getTime() + args.roundDurationMs);

    const serverSeed = randomBytes(32).toString('hex');
    const serverSeedHash = createHash('sha256')
      .update(serverSeed)
      .digest('hex');

    return tx.round.create({
      data: {
        roomId: args.roomId,
        roundNumber,
        status: RoundStatus.OPEN,
        openedAt,
        locksAt,
        serverSeedHash,
        serverSeedReveal: serverSeed,
        idempotencyKey: `round:start:${args.roomId}:${roundNumber}`,
      },
    });
  }

  private async findOrCreateOpenRoundForRoomTx(
    tx: Prisma.TransactionClient,
    args: {
      roomId: string;
      roundDurationMs: number;
    },
  ) {
    const existingCurrentRound = await tx.round.findFirst({
      where: {
        roomId: args.roomId,
        status: { in: ACTIVE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (existingCurrentRound) {
      return existingCurrentRound;
    }

    const latestRound = await tx.round.findFirst({
      where: { roomId: args.roomId },
      orderBy: { roundNumber: 'desc' },
      select: { roundNumber: true },
    });

    return this.createOpenRoundForRoomTx(tx, {
      roomId: args.roomId,
      roundDurationMs: args.roundDurationMs,
      latestRoundNumber: latestRound?.roundNumber ?? 0,
    });
  }

  async lockCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: RoundStatus.OPEN,
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      throw new BadRequestException(
        'Room does not have an OPEN round to lock.',
      );
    }

    const finalRound = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${currentRound.id})::bigint)
      `;

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
        throw new BadRequestException('Round is no longer OPEN.');
      }

      const [assignment] = await tx.$queryRaw<
        Array<{ entryCount: bigint; totalAmount: bigint }>
      >`
        WITH ordered AS (
          SELECT
            e.id,
            COALESCE(
              SUM(e.amount) OVER (
                ORDER BY e."createdAt", e.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            )::bigint AS "ticketStart",
            (SUM(e.amount) OVER (ORDER BY e."createdAt", e.id) - 1)::bigint AS "ticketEnd"
          FROM entries e
          WHERE e."roundId" = ${currentRound.id}
        ),
        updated AS (
          UPDATE entries e
          SET
            "ticketStart" = ordered."ticketStart",
            "ticketEnd" = ordered."ticketEnd",
            "updatedAt" = now()
          FROM ordered
          WHERE e.id = ordered.id
          RETURNING e.id
        )
        SELECT
          (SELECT COUNT(*)::bigint FROM updated) AS "entryCount",
          COALESCE(MAX(ordered."ticketEnd") + 1, 0)::bigint AS "totalAmount"
        FROM ordered
      `;

      if (!assignment || assignment.entryCount < 2n) {
        throw new BadRequestException(
          'Cannot lock a round with fewer than two entries.',
        );
      }

      const finalTotal = assignment.totalAmount;

      const updatedRound = await tx.round.update({
        where: { id: currentRound.id },
        data: {
          totalEntryAmount: finalTotal,
          houseFeeAmount: 0n,
          payoutAmount: finalTotal,
          updatedAt: new Date(),
        },
      });

      if (finalTotal !== updatedRound.totalEntryAmount) {
        throw new BadRequestException(
          'Ticket assignment mismatch. Round total does not equal assigned tickets.',
        );
      }

      return updatedRound;
    }, this.transactionOptions);

    const finalEntries = await this.prisma.entry.findMany({
      where: { roundId: currentRound.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return {
      currentRound: this.toRoundSnapshot(finalRound),
      entries: finalEntries.map((entry) => this.toEntrySnapshot(entry)),
    };
  }

  async drawCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: [RoundStatus.LOCKED, RoundStatus.DRAWING] },
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      throw new BadRequestException(
        'Room does not have a LOCKED round ready to draw.',
      );
    }

    const entries = await this.prisma.entry.findMany({
      where: { roundId: currentRound.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (entries.length < 2) {
      throw new BadRequestException(
        'Cannot draw a round with fewer than two entries.',
      );
    }

    if (currentRound.totalEntryAmount <= 0n) {
      throw new BadRequestException('Cannot draw a round with zero total.');
    }

    const invalidRangeEntry = entries.find(
      (entry) => entry.ticketStart === null || entry.ticketEnd === null,
    );

    if (invalidRangeEntry) {
      throw new BadRequestException(
        'Cannot draw before ticket ranges are assigned. Lock the round first.',
      );
    }

    if (!currentRound.serverSeedReveal) {
      throw new BadRequestException(
        'Round is missing server seed reveal. Cannot draw safely.',
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
        'Winning ticket did not match any entry. Manual review required.',
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
          'Round changed while drawing. Retry or review manually.',
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
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      const finalWinnerEntry = finalEntries.find(
        (entry) => entry.id === winnerEntry.id,
      );

      if (!finalWinnerEntry) {
        throw new BadRequestException('Winner entry disappeared after draw.');
      }

      return {
        round: finalRound,
        winnerEntry: finalWinnerEntry,
        entries: finalEntries,
        reused: false,
      };
    }, this.transactionOptions);

    return {
      currentRound: this.toRoundSnapshot(result.round),
      winningTicket: result.round.winningTicket?.toString() ?? null,
      winnerEntry: this.toEntrySnapshot(result.winnerEntry),
      entries: result.entries.map((entry) => this.toEntrySnapshot(entry)),
      reused: result.reused,
    };
  }

  async startSpinningCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: [RoundStatus.DRAWING, RoundStatus.SPINNING] },
        winningTicket: { not: null },
        winnerEntryId: { not: null },
        winnerUserId: { not: null },
        spinAngle: { not: null },
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      throw new BadRequestException(
        'Room does not have a DRAWING round ready to spin.',
      );
    }

    if (currentRound.status === RoundStatus.SPINNING) {
      const winnerEntry = currentRound.winnerEntryId
        ? await this.prisma.entry.findUnique({
            where: { id: currentRound.winnerEntryId },
          })
        : null;

      return {
        currentRound: this.toRoundSnapshot(currentRound),
        winnerEntry: winnerEntry ? this.toEntrySnapshot(winnerEntry) : null,
        reused: true,
      };
    }

    const updateResult = await this.prisma.round.updateMany({
      where: {
        id: currentRound.id,
        status: RoundStatus.DRAWING,
        winningTicket: { not: null },
        winnerEntryId: { not: null },
        winnerUserId: { not: null },
        spinAngle: { not: null },
      },
      data: {
        status: RoundStatus.SPINNING,
        spinningAt: new Date(),
      },
    });

    if (updateResult.count !== 1) {
      const racedRound = await this.prisma.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      if (
        racedRound.status !== RoundStatus.SPINNING ||
        racedRound.winningTicket === null ||
        !racedRound.winnerEntryId ||
        !racedRound.winnerUserId ||
        racedRound.spinAngle === null
      ) {
        throw new BadRequestException(
          'Round changed while starting SPINNING phase. Retry or review manually.',
        );
      }
    }

    const spinningRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: currentRound.id },
    });

    const winnerEntry = spinningRound.winnerEntryId
      ? await this.prisma.entry.findUnique({
          where: { id: spinningRound.winnerEntryId },
        })
      : null;

    return {
      currentRound: this.toRoundSnapshot(spinningRound),
      winnerEntry: winnerEntry ? this.toEntrySnapshot(winnerEntry) : null,
      reused: false,
    };
  }

  async startSettlingCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: [RoundStatus.SPINNING, RoundStatus.SETTLING] },
        winnerEntryId: { not: null },
        winnerUserId: { not: null },
        winningTicket: { not: null },
        spinAngle: { not: null },
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      throw new BadRequestException(
        'Room does not have a SPINNING round ready to start settlement.',
      );
    }

    if (currentRound.payoutAmount <= 0n) {
      throw new BadRequestException(
        'Round payout amount must be greater than zero.',
      );
    }

    const winnerEntryId = currentRound.winnerEntryId;

    if (!winnerEntryId || !currentRound.winnerUserId) {
      throw new BadRequestException(
        'Round has no winner yet. Draw/spin the round before settlement.',
      );
    }

    if (currentRound.status === RoundStatus.SETTLING) {
      const winnerEntry = await this.prisma.entry.findUnique({
        where: { id: winnerEntryId },
      });

      return {
        currentRound: this.toRoundSnapshot(currentRound),
        winnerEntry: winnerEntry ? this.toEntrySnapshot(winnerEntry) : null,
        payoutAmount: currentRound.payoutAmount.toString(),
        payout: null,
        reused: true,
      };
    }

    const updateResult = await this.prisma.round.updateMany({
      where: {
        id: currentRound.id,
        status: RoundStatus.SPINNING,
        winnerEntryId: { not: null },
        winnerUserId: { not: null },
        winningTicket: { not: null },
        spinAngle: { not: null },
      },
      data: {
        status: RoundStatus.SETTLING,
        settlingAt: new Date(),
      },
    });

    if (updateResult.count !== 1) {
      const racedRound = await this.prisma.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      if (racedRound.status !== RoundStatus.SETTLING) {
        throw new BadRequestException(
          'Round changed while starting SETTLING phase. Retry or review manually.',
        );
      }
    }

    const settlingRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: currentRound.id },
    });

    const winnerEntry = await this.prisma.entry.findUnique({
      where: { id: winnerEntryId },
    });

    return {
      currentRound: this.toRoundSnapshot(settlingRound),
      winnerEntry: winnerEntry ? this.toEntrySnapshot(winnerEntry) : null,
      payoutAmount: settlingRound.payoutAmount.toString(),
      payout: null,
      reused: false,
    };
  }

  async settleCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: RoundStatus.SETTLING,
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      const latestRound = await this.prisma.round.findFirst({
        where: {
          roomId,
        },
        orderBy: { roundNumber: 'desc' },
      });

      if (
        latestRound?.status === RoundStatus.COMPLETED &&
        latestRound.winnerEntryId &&
        latestRound.winnerUserId
      ) {
        const completedRound = latestRound;
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
        'Room does not have a SETTLING round ready to complete.',
      );
    }

    const winnerUserId = currentRound.winnerUserId;
    const winnerEntryId = currentRound.winnerEntryId;

    if (!winnerEntryId || !winnerUserId) {
      throw new BadRequestException(
        'Round has no winner yet. Draw the round before settlement.',
      );
    }

    if (currentRound.payoutAmount <= 0n) {
      throw new BadRequestException(
        'Round payout amount must be greater than zero.',
      );
    }

    const winnerEntry = await this.prisma.entry.findUnique({
      where: { id: winnerEntryId },
    });

    if (!winnerEntry) {
      throw new BadRequestException('Winner entry not found.');
    }

    if (winnerEntry.userId !== winnerUserId) {
      throw new BadRequestException(
        'Winner entry user does not match round winner user. Manual review required.',
      );
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
          'Payout was created but round could not be marked COMPLETED. Retry settlement.',
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
  async cancelExpiredOpenRoundForRoom(roomId: string, roundId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    if (!roundId) {
      throw new BadRequestException('roundId is required.');
    }

    const { cancelledRound, refundResults } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${roundId})::bigint)
        `;

        const round = await tx.round.findUnique({
          where: { id: roundId },
        });

        if (!round || round.roomId !== roomId) {
          throw new NotFoundException('Round not found.');
        }

        if (round.status === RoundStatus.CANCELLED) {
          return {
            cancelledRound: round,
            refundResults: [] satisfies EntryRefundResult[],
          };
        }

        if (round.status !== RoundStatus.OPEN) {
          throw new BadRequestException(
            'Round changed before expired OPEN cancellation could start.',
          );
        }

        if (!round.locksAt || round.locksAt.getTime() > Date.now()) {
          throw new BadRequestException('Round is not an expired OPEN round.');
        }

        const entries = await tx.entry.findMany({
          where: { roundId: round.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });

        const refundResults: EntryRefundResult[] = [];

        for (const entry of entries) {
          refundResults.push(
            await this.walletsService.refundEntryHolds(tx, {
              roundId: round.id,
              entryId: entry.id,
            }),
          );
        }

        const cancelResult = await tx.round.updateMany({
          where: {
            id: round.id,
            status: RoundStatus.OPEN,
          },
          data: {
            status: RoundStatus.CANCELLED,
            cancelledAt: new Date(),
          },
        });

        if (cancelResult.count !== 1) {
          throw new BadRequestException(
            'Round could not be marked CANCELLED. Manual review required.',
          );
        }

        return {
          cancelledRound: await tx.round.findUniqueOrThrow({
            where: { id: round.id },
          }),
          refundResults,
        };
      },
      this.transactionOptions,
    );

    return this.toRoundCancellationResult(cancelledRound, refundResults);
  }

  async cancelExpiredOpenRoundAndStartNextForRoom(
    roomId: string,
    roundId: string,
  ) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    if (!roundId) {
      throw new BadRequestException('roundId is required.');
    }

    const startedAt = Date.now();
    const { cancelledRound, refundResults, nextRound, timing } =
      await this.cancelRoundAndStartNextForRoomTx({
        roomId,
        roundId,
        requireExpiredOpen: true,
        requestStartedAt: startedAt,
      });

    this.logRoundTransactionIfSlow(
      roomId,
      'cancelExpiredOpenRoundAndStartNextForRoom',
      Date.now() - startedAt,
      `roundId=${roundId} refunds=${refundResults.length} ${this.formatCancelAndStartTiming(timing)}`,
    );

    const cancellation = this.toRoundCancellationResult(
      cancelledRound,
      refundResults,
    );

    return {
      cancelledRound: cancellation.currentRound,
      currentRound: this.toRoundSnapshot(nextRound),
      refundSummary: {
        refundedCount: cancellation.refundedCount,
        skippedCount: cancellation.skippedCount,
        alreadyRefundedCount: cancellation.alreadyRefundedCount,
        refundedAmount: cancellation.refundedAmount,
      },
    };
  }

  async cancelExpiredEmptyOpenRoundAndStartNextForRoom(
    roomId: string,
    roundId: string,
  ) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    if (!roundId) {
      throw new BadRequestException('roundId is required.');
    }

    const startedAt = Date.now();
    const openedAt = new Date();
    const nextRoundId = randomUUID();
    const serverSeed = randomBytes(32).toString('hex');
    const serverSeedHash = createHash('sha256')
      .update(serverSeed)
      .digest('hex');

    const rows = await this.prisma.$queryRaw<EmptyCancelAndStartRow[]>(
      Prisma.sql`
        WITH locks AS (
          SELECT
            pg_try_advisory_xact_lock(hashtext(${roomId})) AS "roomLocked",
            pg_try_advisory_xact_lock(hashtext(${roundId})::bigint) AS "roundLocked"
        ),
        candidate AS (
          SELECT
            ro.id,
            r."roundDurationMs"
          FROM rounds ro
          JOIN rooms r ON r.id = ro."roomId"
          CROSS JOIN locks
          WHERE locks."roomLocked" = true
            AND locks."roundLocked" = true
            AND ro.id = ${roundId}
            AND ro."roomId" = ${roomId}
            AND ro.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
            AND ro."locksAt" IS NOT NULL
            AND ro."locksAt" <= ${openedAt}
            AND r.status = CAST(${'ACTIVE'} AS "RoomStatus")
            AND NOT EXISTS (
              SELECT 1
              FROM entries e
              WHERE e."roundId" = ro.id
            )
          LIMIT 1
        ),
        cancelled AS (
          UPDATE rounds ro
          SET
            status = CAST(${RoundStatus.CANCELLED} AS "RoundStatus"),
            "cancelledAt" = ${openedAt},
            "updatedAt" = ${openedAt}
          FROM candidate c
          WHERE ro.id = c.id
            AND ro.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
          RETURNING ro.*
        ),
        latest AS (
          SELECT COALESCE(MAX(ro."roundNumber"), 0) + 1 AS "roundNumber"
          FROM rounds ro
          WHERE ro."roomId" = ${roomId}
        ),
        inserted AS (
          INSERT INTO rounds (
            id,
            "roomId",
            "roundNumber",
            status,
            "openedAt",
            "locksAt",
            "totalEntryAmount",
            "houseFeeAmount",
            "payoutAmount",
            "serverSeedHash",
            "serverSeedReveal",
            "idempotencyKey",
            "createdAt",
            "updatedAt"
          )
          SELECT
            ${nextRoundId},
            ${roomId},
            latest."roundNumber",
            CAST(${RoundStatus.OPEN} AS "RoundStatus"),
            ${openedAt},
            ${openedAt} + (candidate."roundDurationMs" * INTERVAL '1 millisecond'),
            0,
            0,
            0,
            ${serverSeedHash},
            ${serverSeed},
            'round:start:' || ${roomId} || ':' || latest."roundNumber"::text,
            ${openedAt},
            ${openedAt}
          FROM candidate
          CROSS JOIN latest
          WHERE EXISTS (SELECT 1 FROM cancelled)
          ON CONFLICT ("roomId", "roundNumber") DO NOTHING
          RETURNING *
        )
        SELECT
          c.id AS "cancelledId",
          c."roomId" AS "cancelledRoomId",
          c."roundNumber" AS "cancelledRoundNumber",
          c.status AS "cancelledStatus",
          c."totalEntryAmount" AS "cancelledTotalEntryAmount",
          c."houseFeeAmount" AS "cancelledHouseFeeAmount",
          c."payoutAmount" AS "cancelledPayoutAmount",
          c."openedAt" AS "cancelledOpenedAt",
          c."locksAt" AS "cancelledLocksAt",
          c."lockedAt" AS "cancelledLockedAt",
          c."drawingAt" AS "cancelledDrawingAt",
          c."spinningAt" AS "cancelledSpinningAt",
          c."settlingAt" AS "cancelledSettlingAt",
          c."completedAt" AS "cancelledCompletedAt",
          c."cancelledAt" AS "cancelledCancelledAt",
          c."serverSeedHash" AS "cancelledServerSeedHash",
          c."winningTicket" AS "cancelledWinningTicket",
          c."winnerUserId" AS "cancelledWinnerUserId",
          c."winnerEntryId" AS "cancelledWinnerEntryId",
          c."spinAngle" AS "cancelledSpinAngle",
          n.id AS "nextId",
          n."roomId" AS "nextRoomId",
          n."roundNumber" AS "nextRoundNumber",
          n.status AS "nextStatus",
          n."totalEntryAmount" AS "nextTotalEntryAmount",
          n."houseFeeAmount" AS "nextHouseFeeAmount",
          n."payoutAmount" AS "nextPayoutAmount",
          n."openedAt" AS "nextOpenedAt",
          n."locksAt" AS "nextLocksAt",
          n."lockedAt" AS "nextLockedAt",
          n."drawingAt" AS "nextDrawingAt",
          n."spinningAt" AS "nextSpinningAt",
          n."settlingAt" AS "nextSettlingAt",
          n."completedAt" AS "nextCompletedAt",
          n."cancelledAt" AS "nextCancelledAt",
          n."serverSeedHash" AS "nextServerSeedHash",
          n."winningTicket" AS "nextWinningTicket",
          n."winnerUserId" AS "nextWinnerUserId",
          n."winnerEntryId" AS "nextWinnerEntryId",
          n."spinAngle" AS "nextSpinAngle"
        FROM cancelled c
        JOIN inserted n ON true
      `,
    );

    this.logRoundTransactionIfSlow(
      roomId,
      'cancelExpiredEmptyOpenRoundAndStartNextForRoomFast',
      Date.now() - startedAt,
      `roundId=${roundId} rows=${rows.length}`,
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      cancelledRound: this.toRoundSnapshot(
        this.toRoundFromEmptyCancelAndStartRow(row, 'cancelled'),
      ),
      currentRound: this.toRoundSnapshot(
        this.toRoundFromEmptyCancelAndStartRow(row, 'next'),
      ),
      refundSummary: {
        refundedCount: 0,
        skippedCount: 0,
        alreadyRefundedCount: 0,
        refundedAmount: '0',
      },
    };
  }

  async cancelCurrentRoundAndStartNextForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const startedAt = Date.now();
    const { cancelledRound, refundResults, nextRound, timing } =
      await this.cancelRoundAndStartNextForRoomTx({
        roomId,
        requireExpiredOpen: false,
        requestStartedAt: startedAt,
      });

    this.logRoundTransactionIfSlow(
      roomId,
      'cancelCurrentRoundAndStartNextForRoom',
      Date.now() - startedAt,
      `refunds=${refundResults.length} ${this.formatCancelAndStartTiming(timing)}`,
    );

    const cancellation = this.toRoundCancellationResult(
      cancelledRound,
      refundResults,
    );

    return {
      cancelledRound: cancellation.currentRound,
      currentRound: this.toRoundSnapshot(nextRound),
      refundSummary: {
        refundedCount: cancellation.refundedCount,
        skippedCount: cancellation.skippedCount,
        alreadyRefundedCount: cancellation.alreadyRefundedCount,
        refundedAmount: cancellation.refundedAmount,
      },
    };
  }

  private async cancelRoundAndStartNextForRoomTx(args: {
    roomId: string;
    roundId?: string;
    requireExpiredOpen: boolean;
    requestStartedAt?: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const timing: CancelAndStartTiming = {
        transactionWaitMs: Date.now() - (args.requestStartedAt ?? Date.now()),
        roomLockMs: 0,
        roundLockMs: 0,
        findEntriesMs: 0,
        refundMs: 0,
        cancelMs: 0,
        nextRoundMs: 0,
      };

      const roomLockStartedAt = Date.now();
      const roomLockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${args.roomId})) AS locked
      `;
      timing.roomLockMs = Date.now() - roomLockStartedAt;

      if (roomLockResult[0]?.locked !== true) {
        throw new ConflictException(
          'Another round start is already running for this room.',
        );
      }

      const room = await tx.room.findUnique({
        where: { id: args.roomId },
        select: {
          id: true,
          status: true,
          roundDurationMs: true,
        },
      });

      if (!room) {
        throw new NotFoundException('Room not found.');
      }

      if (room.status !== 'ACTIVE') {
        throw new BadRequestException('Only ACTIVE rooms can start rounds.');
      }

      let round = args.roundId
        ? await tx.round.findUnique({
            where: { id: args.roundId },
          })
        : await tx.round.findFirst({
            where: {
              roomId: args.roomId,
              status: { in: CANCELLABLE_ROUND_STATUSES },
            },
            orderBy: { roundNumber: 'desc' },
          });

      if (!round || round.roomId !== args.roomId) {
        throw new NotFoundException('Round not found.');
      }

      const roundLockStartedAt = Date.now();
      const roundLockResult = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${round.id})::bigint) AS locked
      `;
      timing.roundLockMs = Date.now() - roundLockStartedAt;

      if (roundLockResult[0]?.locked !== true) {
        throw new ConflictException(
          'Another round transition is already running for this round.',
        );
      }

      round = await tx.round.findUniqueOrThrow({
        where: { id: round.id },
      });

      if (round.status !== RoundStatus.CANCELLED) {
        if (!CANCELLABLE_ROUND_STATUSES.includes(round.status)) {
          throw new BadRequestException(
            'Round changed before cancellation could start.',
          );
        }

        if (args.requireExpiredOpen) {
          if (round.status !== RoundStatus.OPEN) {
            throw new BadRequestException(
              'Round changed before expired OPEN cancellation could start.',
            );
          }

          if (!round.locksAt || round.locksAt.getTime() > Date.now()) {
            throw new BadRequestException(
              'Round is not an expired OPEN round.',
            );
          }
        }

        if (round.status === RoundStatus.OPEN && !args.requireExpiredOpen) {
          const stopEntryResult = await tx.round.updateMany({
            where: {
              id: round.id,
              status: RoundStatus.OPEN,
            },
            data: {
              status: RoundStatus.LOCKED,
              lockedAt: new Date(),
            },
          });

          if (stopEntryResult.count !== 1) {
            round = await tx.round.findUniqueOrThrow({
              where: { id: round.id },
            });

            if (!CANCELLABLE_ROUND_STATUSES.includes(round.status)) {
              throw new BadRequestException(
                'Round changed while cancellation was starting. Retry cancel.',
              );
            }
          } else {
            round = await tx.round.findUniqueOrThrow({
              where: { id: round.id },
            });
          }
        }
      }

      const entries =
        round.status === RoundStatus.CANCELLED
          ? []
          : await this.measureCancelAndStartPart(timing, 'findEntriesMs', () =>
              tx.entry.findMany({
                where: { roundId: round.id },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              }),
            );

      const refundResults: EntryRefundResult[] = [];

      await this.measureCancelAndStartPart(timing, 'refundMs', async () => {
        for (const entry of entries) {
          refundResults.push(
            await this.walletsService.refundEntryHolds(tx, {
              roundId: round.id,
              entryId: entry.id,
            }),
          );
        }
      });

      if (round.status !== RoundStatus.CANCELLED) {
        const cancelResult = await this.measureCancelAndStartPart(
          timing,
          'cancelMs',
          () =>
            tx.round.updateMany({
              where: {
                id: round.id,
                status: { in: CANCELLABLE_ROUND_STATUSES },
              },
              data: {
                status: RoundStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            }),
        );

        if (cancelResult.count !== 1) {
          throw new BadRequestException(
            'Round could not be marked CANCELLED. Manual review required.',
          );
        }
      }

      const cancelledRound = await tx.round.findUniqueOrThrow({
        where: { id: round.id },
      });
      const nextRound = await this.measureCancelAndStartPart(
        timing,
        'nextRoundMs',
        () =>
          this.findOrCreateOpenRoundForRoomTx(tx, {
            roomId: args.roomId,
            roundDurationMs: room.roundDurationMs,
          }),
      );

      return {
        cancelledRound,
        refundResults,
        nextRound,
        timing,
      };
    }, this.transactionOptions);
  }

  async cancelCurrentRoundForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: { in: CANCELLABLE_ROUND_STATUSES },
      },
      orderBy: { roundNumber: 'desc' },
    });

    if (!currentRound) {
      const cancelledRound = await this.prisma.round.findFirst({
        where: {
          roomId,
          status: RoundStatus.CANCELLED,
        },
        orderBy: { roundNumber: 'desc' },
      });

      if (cancelledRound) {
        return this.toRoundCancellationResult(cancelledRound, [], true);
      }

      throw new BadRequestException('Room does not have a cancellable round.');
    }

    let roundForCancellation = currentRound;

    if (currentRound.status === RoundStatus.OPEN) {
      const stopEntryResult = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${currentRound.id})::bigint)
        `;

        return tx.round.updateMany({
          where: {
            id: currentRound.id,
            status: RoundStatus.OPEN,
          },
          data: {
            status: RoundStatus.LOCKED,
            lockedAt: new Date(),
          },
        });
      }, this.transactionOptions);

      if (stopEntryResult.count !== 1) {
        const racedRound = await this.prisma.round.findUniqueOrThrow({
          where: { id: currentRound.id },
        });

        if (racedRound.status === RoundStatus.CANCELLED) {
          return this.toRoundCancellationResult(racedRound, [], true);
        }

        if (!CANCELLABLE_ROUND_STATUSES.includes(racedRound.status)) {
          throw new BadRequestException(
            'Round changed while cancellation was starting. Retry cancel.',
          );
        }

        roundForCancellation = racedRound;
      } else {
        roundForCancellation = await this.prisma.round.findUniqueOrThrow({
          where: { id: currentRound.id },
        });
      }
    }

    const entries = await this.prisma.entry.findMany({
      where: { roundId: roundForCancellation.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const refundResults: EntryRefundResult[] = [];

    for (const entry of entries) {
      const refundResult = await this.walletsService.refundEntryHoldsByEntryId({
        roundId: roundForCancellation.id,
        entryId: entry.id,
      });

      refundResults.push(refundResult);
    }

    const cancelResult = await this.prisma.round.updateMany({
      where: {
        id: roundForCancellation.id,
        status: { in: CANCELLABLE_ROUND_STATUSES },
      },
      data: {
        status: RoundStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    if (cancelResult.count !== 1) {
      const round = await this.prisma.round.findUniqueOrThrow({
        where: { id: roundForCancellation.id },
      });

      if (round.status !== RoundStatus.CANCELLED) {
        throw new BadRequestException(
          'Round could not be marked CANCELLED. Manual review required.',
        );
      }
    }

    const cancelledRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: roundForCancellation.id },
    });

    return this.toRoundCancellationResult(cancelledRound, refundResults);
  }

  async getLatestRoundResultForRoom(roomId: string) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const existing = this.inFlightLatestResultByRoom.get(roomId);

    if (existing) {
      return existing;
    }

    const request = this.measureLatestResult(roomId, () =>
      this.buildLatestRoundResultForRoom(roomId),
    ).finally(() => {
      if (this.inFlightLatestResultByRoom.get(roomId) === request) {
        this.inFlightLatestResultByRoom.delete(roomId);
      }
    });

    this.inFlightLatestResultByRoom.set(roomId, request);

    return request;
  }

  private async measureLatestResult<T>(roomId: string, work: () => Promise<T>) {
    const startedAt = Date.now();

    try {
      return await work();
    } finally {
      const durationMs = Date.now() - startedAt;

      if (durationMs >= LATEST_RESULT_TIMING_WARN_THRESHOLD_MS) {
        this.logger.warn(
          `[latest-result-timing:${roomId}] build duration=${durationMs}ms`,
        );
      }
    }
  }

  private async measureLatestResultPart<T>(
    roomId: string,
    label: string,
    work: () => Promise<T> | T,
  ) {
    const startedAt = Date.now();

    try {
      return await work();
    } finally {
      this.logLatestResultPart(roomId, label, Date.now() - startedAt);
    }
  }

  private logLatestResultPart(
    roomId: string,
    label: string,
    durationMs: number,
    details?: string,
  ) {
    if (durationMs < LATEST_RESULT_TIMING_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[latest-result-timing:${roomId}] ${label} duration=${durationMs}ms${
        details ? ` ${details}` : ''
      }`,
    );
  }

  private logRoundTransactionIfSlow(
    roomId: string,
    label: string,
    durationMs: number,
    details?: string,
  ) {
    if (durationMs < ROUND_TRANSACTION_TIMING_WARN_THRESHOLD_MS) {
      return;
    }

    this.logger.warn(
      `[round-transaction-timing:${roomId}] ${label} duration=${durationMs}ms${
        details ? ` ${details}` : ''
      } dbWaitMayBeIncluded=true`,
    );
  }

  private async measureCancelAndStartPart<T>(
    timing: CancelAndStartTiming,
    key: keyof Omit<CancelAndStartTiming, 'transactionWaitMs'>,
    work: () => Promise<T> | T,
  ) {
    const startedAt = Date.now();

    try {
      return await work();
    } finally {
      timing[key] = Date.now() - startedAt;
    }
  }

  private formatCancelAndStartTiming(timing: CancelAndStartTiming) {
    return [
      `txWait=${timing.transactionWaitMs}ms`,
      `roomLock=${timing.roomLockMs}ms`,
      `roundLock=${timing.roundLockMs}ms`,
      `entries=${timing.findEntriesMs}ms`,
      `refunds=${timing.refundMs}ms`,
      `cancel=${timing.cancelMs}ms`,
      `nextOpen=${timing.nextRoundMs}ms`,
    ].join(' ');
  }

  private toRoundFromEmptyCancelAndStartRow(
    row: EmptyCancelAndStartRow,
    prefix: 'cancelled' | 'next',
  ): RoundSnapshotSource {
    if (prefix === 'cancelled') {
      return {
        id: row.cancelledId,
        roomId: row.cancelledRoomId,
        roundNumber: row.cancelledRoundNumber,
        status: row.cancelledStatus,
        totalEntryAmount: row.cancelledTotalEntryAmount,
        houseFeeAmount: row.cancelledHouseFeeAmount,
        payoutAmount: row.cancelledPayoutAmount,
        openedAt: row.cancelledOpenedAt,
        locksAt: row.cancelledLocksAt,
        lockedAt: row.cancelledLockedAt,
        drawingAt: row.cancelledDrawingAt,
        spinningAt: row.cancelledSpinningAt,
        settlingAt: row.cancelledSettlingAt,
        completedAt: row.cancelledCompletedAt,
        cancelledAt: row.cancelledCancelledAt,
        serverSeedHash: row.cancelledServerSeedHash,
        winningTicket: row.cancelledWinningTicket,
        winnerUserId: row.cancelledWinnerUserId,
        winnerEntryId: row.cancelledWinnerEntryId,
        spinAngle: row.cancelledSpinAngle,
      };
    }

    return {
      id: row.nextId,
      roomId: row.nextRoomId,
      roundNumber: row.nextRoundNumber,
      status: row.nextStatus,
      totalEntryAmount: row.nextTotalEntryAmount,
      houseFeeAmount: row.nextHouseFeeAmount,
      payoutAmount: row.nextPayoutAmount,
      openedAt: row.nextOpenedAt,
      locksAt: row.nextLocksAt,
      lockedAt: row.nextLockedAt,
      drawingAt: row.nextDrawingAt,
      spinningAt: row.nextSpinningAt,
      settlingAt: row.nextSettlingAt,
      completedAt: row.nextCompletedAt,
      cancelledAt: row.nextCancelledAt,
      serverSeedHash: row.nextServerSeedHash,
      winningTicket: row.nextWinningTicket,
      winnerUserId: row.nextWinnerUserId,
      winnerEntryId: row.nextWinnerEntryId,
      spinAngle: row.nextSpinAngle,
    };
  }

  private async buildLatestRoundResultForRoom(roomId: string) {
    const rows = await this.measureLatestResultPart(roomId, 'round query', () =>
      this.queryLatestRoundResultRows(roomId),
    );

    const entryRowCount = rows.filter((row) => row.entryId).length;

    this.logLatestResultPart(
      roomId,
      'entries query',
      0,
      `source=joined rows=${entryRowCount}`,
    );

    return this.measureLatestResultPart(roomId, 'serialization', () =>
      this.serializeLatestRoundResultRows(rows),
    );
  }

  async getPublicWinnerFeed(scope: WinnerFeedScope, limit = 30) {
    const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
    const since =
      scope === 'week'
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
        : scope === 'month'
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000)
          : null;
    const rows = await this.queryPublicWinnerFeedRows(scope, safeLimit, since);

    return {
      scope,
      limit: safeLimit,
      generatedAt: new Date().toISOString(),
      winners: rows.map((row, index) => ({
        rank: index + 1,
        roundId: row.roundId,
        roomId: row.roomId,
        roomCode: row.roomCode,
        roomName: row.roomName,
        roomMaxPlayers: row.roomMaxPlayers,
        roomGameMode: row.roomGameMode,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        roundNumber: row.roundNumber,
        completedAt: row.completedAt?.toISOString() ?? null,
        totalEntryAmount: row.totalEntryAmount.toString(),
        payoutAmount: row.payoutAmount.toString(),
        winnerUserId: row.winnerUserId,
        winnerEntryId: row.winnerEntryId,
        winnerEntryAmount: (row.winnerEntryAmount ?? 0n).toString(),
        winnerUsername: row.winnerUsername,
        playerCount: Number(row.playerCount ?? 0),
        entryCount: Number(row.entryCount ?? 0),
      })),
    };
  }

  private queryPublicWinnerFeedRows(
    scope: WinnerFeedScope,
    limit: number,
    since: Date | null,
  ) {
    const sinceFilter = since
      ? Prisma.sql`AND ro."completedAt" >= ${since}`
      : Prisma.empty;
    const orderBy =
      scope === 'latest'
        ? Prisma.sql`ro."completedAt" DESC NULLS LAST, ro."roundNumber" DESC`
        : Prisma.sql`ro."payoutAmount" DESC, ro."completedAt" DESC NULLS LAST`;

    return this.prisma.$queryRaw<WinnerFeedRow[]>(Prisma.sql`
      WITH entry_stats AS (
        SELECT
          e."roundId",
          COUNT(*) AS "entryCount",
          COUNT(DISTINCT e."userId") AS "playerCount"
        FROM entries e
        GROUP BY e."roundId"
      )
      SELECT
        ro.id AS "roundId",
        ro."roomId" AS "roomId",
        r.code AS "roomCode",
        r.name AS "roomName",
        r."maxPlayers" AS "roomMaxPlayers",
        r."gameMode"::text AS "roomGameMode",
        c.slug AS "categorySlug",
        c.name AS "categoryName",
        ro."roundNumber" AS "roundNumber",
        ro."completedAt" AS "completedAt",
        ro."totalEntryAmount" AS "totalEntryAmount",
        ro."payoutAmount" AS "payoutAmount",
        ro."winnerUserId" AS "winnerUserId",
        ro."winnerEntryId" AS "winnerEntryId",
        e.amount AS "winnerEntryAmount",
        u.username AS "winnerUsername",
        COALESCE(stats."playerCount", 0) AS "playerCount",
        COALESCE(stats."entryCount", 0) AS "entryCount"
      FROM rounds ro
      INNER JOIN rooms r ON r.id = ro."roomId"
      INNER JOIN categories c ON c.id = r."categoryId"
      LEFT JOIN entries e ON e.id = ro."winnerEntryId"
      LEFT JOIN users u ON u.id = ro."winnerUserId"
      LEFT JOIN entry_stats stats ON stats."roundId" = ro.id
      WHERE ro.status = CAST(${RoundStatus.COMPLETED} AS "RoundStatus")
        AND ro."winnerUserId" IS NOT NULL
        AND ro."winnerEntryId" IS NOT NULL
        ${sinceFilter}
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `);
  }

  private async queryLatestRoundResultRows(roomId: string) {
    return this.prisma.$queryRaw<LatestRoundResultRow[]>(Prisma.sql`
      WITH latest_round AS (
        SELECT
          ro.id,
          ro."roomId",
          ro."roundNumber",
          ro.status,
          ro."openedAt",
          ro."locksAt",
          ro."lockedAt",
          ro."drawingAt",
          ro."spinningAt",
          ro."settlingAt",
          ro."completedAt",
          ro."cancelledAt",
          ro."totalEntryAmount",
          ro."houseFeeAmount",
          ro."payoutAmount",
          ro."serverSeedHash",
          ro."serverSeedReveal",
          ro."winningTicket",
          ro."winnerUserId",
          ro."winnerEntryId",
          ro."spinAngle"
        FROM rounds ro
        WHERE ro."roomId" = ${roomId}
          AND ro.status = CAST(${RoundStatus.COMPLETED} AS "RoundStatus")
        ORDER BY ro."roundNumber" DESC, ro."completedAt" DESC NULLS LAST
        LIMIT 1
      )
      SELECT
        lr.id AS "roundId",
        lr."roomId" AS "roundRoomId",
        lr."roundNumber" AS "roundNumber",
        lr.status::text AS "roundStatus",
        lr."openedAt" AS "roundOpenedAt",
        lr."locksAt" AS "roundLocksAt",
        lr."lockedAt" AS "roundLockedAt",
        lr."drawingAt" AS "roundDrawingAt",
        lr."spinningAt" AS "roundSpinningAt",
        lr."settlingAt" AS "roundSettlingAt",
        lr."completedAt" AS "roundCompletedAt",
        lr."cancelledAt" AS "roundCancelledAt",
        lr."totalEntryAmount" AS "roundTotalEntryAmount",
        lr."houseFeeAmount" AS "roundHouseFeeAmount",
        lr."payoutAmount" AS "roundPayoutAmount",
        lr."serverSeedHash" AS "roundServerSeedHash",
        lr."serverSeedReveal" AS "roundServerSeedReveal",
        lr."winningTicket" AS "roundWinningTicket",
        lr."winnerUserId" AS "roundWinnerUserId",
        lr."winnerEntryId" AS "roundWinnerEntryId",
        lr."spinAngle" AS "roundSpinAngle",
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
      FROM latest_round lr
      LEFT JOIN entries e ON e."roundId" = lr.id
      LEFT JOIN users u ON u.id = e."userId"
      ORDER BY e."createdAt" ASC NULLS LAST, e.id ASC NULLS LAST
    `);
  }

  private serializeLatestRoundResultRows(rows: LatestRoundResultRow[]) {
    const first = rows[0];

    if (!first) {
      throw new NotFoundException(
        'No completed round result found for this room.',
      );
    }

    const round: LatestRoundResultRound = {
      id: first.roundId,
      roomId: first.roundRoomId,
      roundNumber: first.roundNumber,
      status: first.roundStatus as RoundStatus,
      openedAt: first.roundOpenedAt,
      locksAt: first.roundLocksAt,
      lockedAt: first.roundLockedAt,
      drawingAt: first.roundDrawingAt,
      spinningAt: first.roundSpinningAt,
      settlingAt: first.roundSettlingAt,
      completedAt: first.roundCompletedAt,
      cancelledAt: first.roundCancelledAt,
      totalEntryAmount: first.roundTotalEntryAmount,
      houseFeeAmount: first.roundHouseFeeAmount,
      payoutAmount: first.roundPayoutAmount,
      serverSeedHash: first.roundServerSeedHash,
      serverSeedReveal: first.roundServerSeedReveal,
      winningTicket: first.roundWinningTicket,
      winnerUserId: first.roundWinnerUserId,
      winnerEntryId: first.roundWinnerEntryId,
      spinAngle: first.roundSpinAngle,
    };

    const entries = rows.flatMap((row) => {
      if (!row.entryId) {
        return [];
      }

      return {
        id: row.entryId,
        roundId: row.entryRoundId ?? round.id,
        userId: row.entryUserId ?? '',
        amount: row.entryAmount ?? 0n,
        ticketStart: row.entryTicketStart,
        ticketEnd: row.entryTicketEnd,
        isWinner: row.entryIsWinner ?? false,
        createdAt: row.entryCreatedAt ?? round.openedAt,
        updatedAt: row.entryUpdatedAt ?? round.openedAt,
        user: {
          id: row.entryPlayerId ?? row.entryUserId ?? '',
          username: row.entryPlayerUsername ?? '',
          fullName: row.entryPlayerFullName,
        },
      };
    });

    const winnerEntry = round.winnerEntryId
      ? (entries.find((entry) => entry.id === round.winnerEntryId) ?? null)
      : null;

    const serverSeedReveal = round.serverSeedReveal;
    const serverSeedHash = round.serverSeedHash;

    const recomputedServerSeedHash = serverSeedReveal
      ? createHash('sha256').update(serverSeedReveal).digest('hex')
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
          ].join(':')
        : null;

    const drawHash = drawInput
      ? createHash('sha256').update(drawInput).digest('hex')
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

  toRoundSnapshot(round: RoundSnapshotSource): RoundSnapshot {
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

  toLiveRoundSnapshot(
    round: RoundSnapshotSource,
    entryCount?: number | null,
  ): LiveRoundSnapshot {
    const serverNow = new Date();
    const publicRoundView = buildPublicRoundPhaseView(
      {
        status: round.status,
        locksAt: round.locksAt,
        lockedAt: round.lockedAt,
        drawingAt: round.drawingAt,
        spinningAt: round.spinningAt,
        settlingAt: round.settlingAt,
        completedAt: round.completedAt,
        cancelledAt: round.cancelledAt,
        winnerEntryId: round.winnerEntryId,
        entryCount,
      },
      serverNow,
    );
    const msUntilLock =
      round.status === RoundStatus.OPEN && round.locksAt
        ? Math.max(0, round.locksAt.getTime() - serverNow.getTime())
        : 0;

    return {
      ...this.toRoundSnapshot(round),
      msUntilLock,
      phase: publicRoundView.phase,
      phaseLabel: publicRoundView.phaseLabel,
      msUntilPhaseEnd: publicRoundView.msUntilPhaseEnd,
      msUntilNextRound: publicRoundView.msUntilNextRound,
      resultReason: publicRoundView.resultReason,
    };
  }

  private toRoundCancellationResult(
    cancelledRound: RoundSnapshotSource,
    refundResults: EntryRefundResult[],
    reused = false,
  ) {
    const refundedCount = refundResults.filter(
      (result) => result.refunded,
    ).length;
    const skippedCount = refundResults.filter(
      (result) => result.reason === 'NO_HOLD_FOUND',
    ).length;
    const alreadyRefundedCount = refundResults.filter(
      (result) => result.reason === 'ALREADY_REFUNDED',
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
      ...(reused ? { reused: true } : {}),
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

  private toTicketRangesFromEntries(
    entries: TicketRangeEntrySource[],
  ): TicketRange[] {
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
  private verifyEntryRanges(
    entries: TicketRangeEntrySource[],
    expectedTotal: bigint,
  ) {
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
