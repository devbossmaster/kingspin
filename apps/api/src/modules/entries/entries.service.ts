import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, RoundStatus, type Entry, type User } from "@kingspin/db";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { RoundsService } from "../rounds/rounds.service";
import { WalletsService } from "../wallets/wallets.service";

export type DevPlaceEntryBody = {
  userId?: unknown;
  playerKey?: unknown;
  amount?: unknown;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    private readonly walletsService: WalletsService,
  ) {}

  async devPlaceEntryForRoom(roomId: string, body: DevPlaceEntryBody) {
    if (!roomId) {
      throw new BadRequestException("roomId is required.");
    }

    const addAmount = this.parseAmount(body?.amount);

    const user = await this.resolveDevUserOutsideTransaction(body);
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
      throw new BadRequestException("Entries are only allowed in active categories.");
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
        : `dev-entry:${currentRound.id}:${user.id}:${randomUUID()}`;

    const existingLedgerTransaction =
      await this.prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: requestIdempotencyKey },
      });

    if (existingLedgerTransaction) {
      const existingEntry = await this.prisma.entry.findUniqueOrThrow({
        where: {
          roundId_userId: {
            roundId: currentRound.id,
            userId: user.id,
          },
        },
      });

      const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      const freshRound = await this.prisma.round.findUniqueOrThrow({
        where: { id: currentRound.id },
      });

      return {
        entry: this.toEntrySnapshot(existingEntry),
        player: this.toPlayerSnapshot(user),
        wallet: this.toWalletSnapshot(freshWallet),
        currentRound: this.roundsService.toRoundSnapshot(freshRound),
        reused: true,
      };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingEntry = await tx.entry.findUnique({
          where: {
            roundId_userId: {
              roundId: currentRound.id,
              userId: user.id,
            },
          },
        });

        let entry: Entry;

        if (!existingEntry) {
          if (addAmount < room.category.minEntryAmount) {
            throw new BadRequestException(
              `Entry amount is below category minimum. Minimum is ${room.category.minEntryAmount.toString()}.`,
            );
          }

          if (addAmount > room.category.maxEntryAmount) {
            throw new BadRequestException(
              `Entry amount is above category maximum. Maximum is ${room.category.maxEntryAmount.toString()}.`,
            );
          }

          entry = await tx.entry.create({
            data: {
              roundId: currentRound.id,
              userId: user.id,
              amount: addAmount,
              ticketStart: null,
              ticketEnd: null,
            },
          });
        } else {
          const finalAmount = existingEntry.amount + addAmount;

          if (finalAmount > room.category.maxEntryAmount) {
            throw new BadRequestException(
              `Entry increase would exceed category maximum. Maximum is ${room.category.maxEntryAmount.toString()}, current is ${existingEntry.amount.toString()}, attempted add is ${addAmount.toString()}.`,
            );
          }

          await tx.entry.update({
            where: { id: existingEntry.id },
            data: {
              amount: {
                increment: addAmount,
              },
              ticketStart: null,
              ticketEnd: null,
            },
          });

          entry = await tx.entry.findUniqueOrThrow({
            where: { id: existingEntry.id },
          });
        }

        const updatedWallet = await this.walletsService.holdEntryAmount(tx, {
          walletAccountId: wallet.id,
          userId: user.id,
          roundId: currentRound.id,
          entryId: entry.id,
          amount: addAmount,
          idempotencyKey: requestIdempotencyKey,
        });

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

        return {
          entry,
          wallet: updatedWallet,
          round: updatedRound,
        };
      });

      return {
        entry: this.toEntrySnapshot(result.entry),
        player: this.toPlayerSnapshot(user),
        wallet: result.wallet,
        currentRound: this.roundsService.toRoundSnapshot(result.round),
        reused: false,
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new BadRequestException(
          "Duplicate entry request detected. Use an idempotency key and retry safely.",
        );
      }

      throw error;
    }
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

  private async resolveDevUserOutsideTransaction(
    body: DevPlaceEntryBody,
  ): Promise<User> {
    if (typeof body?.userId === "string" && body.userId.trim().length > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: body.userId.trim() },
      });

      if (!user) {
        throw new NotFoundException("User not found.");
      }

      return user;
    }

    const playerKey =
      typeof body?.playerKey === "string" && body.playerKey.trim().length > 0
        ? body.playerKey.trim()
        : "player-1";

    const safePlayerKey = playerKey
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .slice(0, 32);

    const email = `dev+${safePlayerKey}@kingspin.local`;
    const username = `dev_${safePlayerKey}`;

    return this.prisma.user.upsert({
      where: { email },
      update: {
        username,
        fullName: `Dev Player ${safePlayerKey}`,
        emailVerified: true,
      },
      create: {
        email,
        username,
        fullName: `Dev Player ${safePlayerKey}`,
        emailVerified: true,
      },
    });
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
