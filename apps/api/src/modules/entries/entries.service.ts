import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LedgerTransactionType,
  Prisma,
  RoundStatus,
  type Entry,
  type User,
} from "@kingspin/db";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { RoundsService } from "../rounds/rounds.service";
import { WalletsService } from "../wallets/wallets.service";

export type PlaceEntryBody = {
  amount?: unknown;
  idempotencyKey?: unknown;
};

export type PlaceEntryForUserArgs = {
  roomId: string;
  userId: string;
  amount: unknown;
  idempotencyKey?: unknown;
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
export class EntriesService {
  private readonly transactionOptions = {
    maxWait: 5_000,
    timeout: 10_000,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    private readonly walletsService: WalletsService,
  ) {}

  async placeEntryForUser(args: PlaceEntryForUserArgs) {
    if (!args.roomId) {
      throw new BadRequestException("roomId is required.");
    }

    if (!args.userId) {
      throw new BadRequestException("Authenticated user id is required.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: args.userId },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    return this.placeEntryForResolvedUser(
      args.roomId,
      {
        amount: args.amount,
        idempotencyKey: args.idempotencyKey,
      },
      user,
      "entry",
    );
  }

  private async placeEntryForResolvedUser(
    roomId: string,
    body: PlaceEntryBody,
    user: User,
    idempotencyScope: "entry",
  ) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const addAmount = this.parseAmount(body?.amount);

    /**
     * Keep read-only validation outside the write transaction.
     * The actual money debit, ledger transaction, entry write, and round total
     * update are done together below in one compact transaction.
     */
    const wallet = await this.walletsService.ensureMainWalletForUserId(user.id);

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { category: true },
    });

    if (!room) {
      throw new NotFoundException("Room not found.");
    }

    if (room.status !== "ACTIVE") {
      throw new BadRequestException("Entries are only allowed in ACTIVE rooms.");
    }

    if (!room.category.isActive) {
      throw new BadRequestException(
        "Entries are only allowed in active categories.",
      );
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId,
        status: RoundStatus.OPEN,
      },
      orderBy: { roundNumber: "desc" },
    });

    if (!currentRound) {
      throw new BadRequestException(
        "Room does not have an OPEN round. Start a round first.",
      );
    }

    const requestIdempotencyKey =
      typeof body?.idempotencyKey === "string" &&
      body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim()
        : `${idempotencyScope}:${currentRound.id}:${user.id}:${randomUUID()}`;

    const idempotencyInspection =
      await this.inspectExistingPlacementSnapshot({
        idempotencyKey: requestIdempotencyKey,
        roundId: currentRound.id,
        userId: user.id,
        walletAccountId: wallet.id,
        amount: addAmount,
        player: user,
      });

    if (idempotencyInspection.placement) {
      return idempotencyInspection.placement;
    }

    const existingEntry = await this.prisma.entry.findUnique({
      where: {
        roundId_userId: {
          roundId: currentRound.id,
          userId: user.id,
        },
      },
    });

    this.assertEntryIncreaseAllowed(addAmount, room.category, existingEntry);

    const entryId =
      existingEntry?.id ??
      idempotencyInspection.pendingEntryId ??
      randomUUID();

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          /**
           * Important performance/safety fix:
           *
           * The old flow did:
           *   1. wallet hold transaction
           *   2. entry write transaction
           *   3. refund transaction if step 2 failed
           *
           * This flow does the wallet debit, ledger entry, entry write, round
           * update, and holdState=APPLIED update in one transaction. If anything
           * fails, everything rolls back together and no compensation refund is
           * needed for the normal path.
           */
          const hold =
            await this.walletsService.holdEntryAmountForEntryInTransaction(tx, {
              walletAccountId: wallet.id,
              userId: user.id,
              roundId: currentRound.id,
              entryId,
              amount: addAmount,
              idempotencyKey: requestIdempotencyKey,
            });

          /**
           * Race-safe idempotency replay:
           *
           * If another identical request finished between the pre-check and this
           * transaction, the ledger hold may already be APPLIED. In that case,
           * return the already-created result instead of incrementing again.
           *
           * If the hold is reused but still HELD, it is an older/pending safe
           * request and this transaction will finish applying it.
           */
          const existingHoldState = this.getMetadataString(
            hold.transaction.metadata,
            "holdState",
          );

          if (hold.reused && existingHoldState !== "HELD") {
            const appliedEntryId =
              this.getMetadataString(hold.transaction.metadata, "entryId") ??
              entryId;

            const replayEntry = await tx.entry.findUniqueOrThrow({
              where: { id: appliedEntryId },
            });

            const replayWallet = await tx.walletAccount.findUniqueOrThrow({
              where: { id: wallet.id },
            });

            const replayRound = await tx.round.findUniqueOrThrow({
              where: { id: currentRound.id },
            });

            return {
              entry: replayEntry,
              wallet: this.toWalletSnapshot(replayWallet),
              round: replayRound,
              reused: true,
            };
          }

          const currentEntry = await tx.entry.findUnique({
            where: {
              roundId_userId: {
                roundId: currentRound.id,
                userId: user.id,
              },
            },
          });

          let entry: Entry;

          if (!currentEntry) {
            entry = await tx.entry.create({
              data: {
                id: entryId,
                roundId: currentRound.id,
                userId: user.id,
                amount: addAmount,
                ticketStart: null,
                ticketEnd: null,
              },
            });
          } else {
            if (!existingEntry && currentEntry.id !== entryId) {
              throw new BadRequestException(
                "Another entry was created for this user and round. Retry the request as a top-up.",
              );
            }

            this.assertEntryIncreaseAllowed(
              addAmount,
              room.category,
              currentEntry,
            );

            const maxAmountBeforeIncrement =
              room.category.maxEntryAmount - addAmount;

            const entryUpdate = await tx.entry.updateMany({
              where: {
                id: currentEntry.id,
                roundId: currentRound.id,
                userId: user.id,
                amount: {
                  lte: maxAmountBeforeIncrement,
                },
              },
              data: {
                amount: {
                  increment: addAmount,
                },
                ticketStart: null,
                ticketEnd: null,
              },
            });

            if (entryUpdate.count !== 1) {
              throw new BadRequestException(
                `Entry increase would exceed category maximum. Maximum is ${room.category.maxEntryAmount.toString()}, current is ${currentEntry.amount.toString()}, attempted add is ${addAmount.toString()}.`,
              );
            }

            entry = await tx.entry.findUniqueOrThrow({
              where: { id: currentEntry.id },
            });
          }

          const roundUpdate = await tx.round.updateMany({
            where: {
              id: currentRound.id,
              status: RoundStatus.OPEN,
            },
            data: {
              totalEntryAmount: { increment: addAmount },
              payoutAmount: { increment: addAmount },
            },
          });

          if (roundUpdate.count !== 1) {
            throw new BadRequestException(
              "Round is no longer OPEN. Entry was not accepted.",
            );
          }

          const updatedRound = await tx.round.findUniqueOrThrow({
            where: { id: currentRound.id },
          });

          await tx.ledgerTransaction.update({
            where: { idempotencyKey: requestIdempotencyKey },
            data: {
              referenceId: entry.id,
              metadata: {
                ...this.toMetadataRecord(hold.transaction.metadata),
                userId: user.id,
                roundId: currentRound.id,
                entryId: entry.id,
                amount: addAmount.toString(),
                walletAccountId: wallet.id,
                holdState: "APPLIED",
                appliedAt: new Date().toISOString(),
                entryAmountAfter: entry.amount.toString(),
                roundTotalEntryAmountAfter:
                  updatedRound.totalEntryAmount.toString(),
                roundPayoutAmountAfter: updatedRound.payoutAmount.toString(),
              },
            },
          });

          return {
            entry,
            wallet: hold.wallet,
            round: updatedRound,
            reused: false,
          };
        },
        this.transactionOptions,
      );

      return {
        entry: this.toEntrySnapshot(result.entry),
        player: this.toPlayerSnapshot(user),
        wallet: result.wallet,
        currentRound: this.roundsService.toRoundSnapshot(result.round),
        reused: result.reused,
      };
    } catch (error) {
      /**
       * If a duplicate idempotency key wins a race, try to replay the completed
       * placement instead of failing the user's click.
       */
      if (this.isUniqueConstraintError(error)) {
        const replayInspection =
          await this.inspectExistingPlacementSnapshot({
            idempotencyKey: requestIdempotencyKey,
            roundId: currentRound.id,
            userId: user.id,
            walletAccountId: wallet.id,
            amount: addAmount,
            player: user,
          });

        if (replayInspection.placement) {
          return replayInspection.placement;
        }

        throw new BadRequestException(
          "Duplicate entry request detected. Use a new idempotency key and retry safely.",
        );
      }

      throw error;
    }
  }

  private async inspectExistingPlacementSnapshot(args: {
    idempotencyKey: string;
    roundId: string;
    userId: string;
    walletAccountId: string;
    amount: bigint;
    player: User;
  }) {
    const transaction = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });

    if (!transaction) {
      return {
        placement: null,
        pendingEntryId: null,
      };
    }

    this.assertEntryHoldTransactionMatches(transaction, args);

    const compensation = await this.prisma.ledgerTransaction.findUnique({
      where: {
        idempotencyKey:
          WalletsService.entryHoldCompensationIdempotencyKey(transaction.id),
      },
    });

    if (compensation) {
      throw new BadRequestException(
        "Previous entry request was refunded after a failed write. Retry with a new idempotency key.",
      );
    }

    const holdState = this.getMetadataString(transaction.metadata, "holdState");

    if (holdState === "HELD") {
      return {
        placement: null,
        pendingEntryId: this.getMetadataString(transaction.metadata, "entryId"),
      };
    }

    const entryId =
      this.getMetadataString(transaction.metadata, "entryId") ?? undefined;

    const entry = entryId
      ? await this.prisma.entry.findUniqueOrThrow({
          where: { id: entryId },
        })
      : await this.prisma.entry.findUniqueOrThrow({
          where: {
            roundId_userId: {
              roundId: args.roundId,
              userId: args.userId,
            },
          },
        });

    const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
      where: { id: args.walletAccountId },
    });

    const freshRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: args.roundId },
    });

    return {
      placement: {
        entry: this.toEntrySnapshot(entry),
        player: this.toPlayerSnapshot(args.player),
        wallet: this.toWalletSnapshot(freshWallet),
        currentRound: this.roundsService.toRoundSnapshot(freshRound),
        reused: true,
      },
      pendingEntryId: entry.id,
    };
  }

  private assertEntryIncreaseAllowed(
    addAmount: bigint,
    category: {
      minEntryAmount: bigint;
      maxEntryAmount: bigint;
    },
    existingEntry: Pick<Entry, "amount"> | null,
  ) {
    if (!existingEntry) {
      if (addAmount < category.minEntryAmount) {
        throw new BadRequestException(
          `Entry amount is below category minimum. Minimum is ${category.minEntryAmount.toString()}.`,
        );
      }

      if (addAmount > category.maxEntryAmount) {
        throw new BadRequestException(
          `Entry amount is above category maximum. Maximum is ${category.maxEntryAmount.toString()}.`,
        );
      }

      return;
    }

    if (existingEntry.amount + addAmount > category.maxEntryAmount) {
      throw new BadRequestException(
        `Entry increase would exceed category maximum. Maximum is ${category.maxEntryAmount.toString()}, current is ${existingEntry.amount.toString()}, attempted add is ${addAmount.toString()}.`,
      );
    }
  }

  private assertEntryHoldTransactionMatches(
    transaction: {
      id: string;
      type: LedgerTransactionType;
      referenceType: string | null;
      metadata: Prisma.JsonValue | null;
    },
    args: {
      roundId: string;
      userId: string;
      walletAccountId: string;
      amount: bigint;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.ENTRY_HOLD &&
      transaction.referenceType === "ENTRY" &&
      this.getMetadataString(transaction.metadata, "roundId") === args.roundId &&
      this.getMetadataString(transaction.metadata, "userId") === args.userId &&
      this.getMetadataString(transaction.metadata, "walletAccountId") ===
        args.walletAccountId &&
      this.getMetadataString(transaction.metadata, "amount") ===
        args.amount.toString();

    if (!matches) {
      throw new BadRequestException(
        "Idempotency key was already used for a different entry request.",
      );
    }
  }

  private getMetadataString(metadata: Prisma.JsonValue | null, key: string) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];

    return typeof value === "string" ? value : null;
  }

  private toMetadataRecord(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return {};
    }

    return metadata as Record<string, Prisma.JsonValue>;
  }

  private parseAmount(rawAmount: unknown): bigint {
    if (typeof rawAmount !== "number") {
      throw new BadRequestException("amount must be a number.");
    }

    if (!Number.isSafeInteger(rawAmount)) {
      throw new BadRequestException("amount must be a safe integer.");
    }

    if (rawAmount <= 0) {
      throw new BadRequestException("amount must be greater than zero.");
    }

    return BigInt(rawAmount);
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }

  private toPlayerSnapshot(user: User) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
    };
  }

  private toWalletSnapshot(wallet: {
    id: string;
    userId: string | null;
    type: string;
    balanceSnapshot: bigint;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: wallet.id,
      userId: wallet.userId,
      type: wallet.type,
      balanceSnapshot: wallet.balanceSnapshot.toString(),
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
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
}
