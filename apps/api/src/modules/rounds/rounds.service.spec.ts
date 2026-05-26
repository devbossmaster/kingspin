import { createHash } from "node:crypto";
import { RoundStatus } from "@kingspin/db";
import { RoundsService } from "./rounds.service";

const now = new Date("2026-05-26T12:00:00.000Z");
const serverSeed =
  "375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d";
const serverSeedHash = createHash("sha256").update(serverSeed).digest("hex");

function buildRound(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmpmhquq2000gcfq01znqehcp",
    roomId: "room-1",
    roundNumber: 2,
    status: RoundStatus.OPEN,
    openedAt: now,
    locksAt: new Date("2026-05-26T12:00:45.000Z"),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    totalEntryAmount: 3_500n,
    houseFeeAmount: 0n,
    payoutAmount: 3_500n,
    serverSeedHash,
    serverSeedReveal: serverSeed,
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
    idempotencyKey: "round:start:room-1:2",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildEntry(
  id: string,
  amount: bigint,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    roundId: "cmpmhquq2000gcfq01znqehcp",
    userId: `user-${id}`,
    amount,
    ticketStart: null,
    ticketEnd: null,
    isWinner: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("RoundsService", () => {
  it("assigns proportional ticket ranges when locking the current round", async () => {
    const openRound = buildRound();
    const entries = [buildEntry("a", 1_500n), buildEntry("b", 2_000n)];
    const finalEntries = [
      buildEntry("a", 1_500n, { ticketStart: 0n, ticketEnd: 1_499n }),
      buildEntry("b", 2_000n, { ticketStart: 1_500n, ticketEnd: 3_499n }),
    ];
    const tx = {
      round: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...openRound,
          status: RoundStatus.LOCKED,
          lockedAt: now,
        }),
      },
      entry: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(entries)
          .mockResolvedValueOnce(finalEntries),
        update: jest.fn(),
      },
    };
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(openRound),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.lockCurrentRoundForRoom("room-1");

    expect(tx.entry.update).toHaveBeenNthCalledWith(1, {
      where: { id: "a" },
      data: { ticketStart: 0n, ticketEnd: 1_499n },
    });
    expect(tx.entry.update).toHaveBeenNthCalledWith(2, {
      where: { id: "b" },
      data: { ticketStart: 1_500n, ticketEnd: 3_499n },
    });
    expect(result.entries).toEqual([
      expect.objectContaining({ id: "a", ticketStart: "0", ticketEnd: "1499" }),
      expect.objectContaining({
        id: "b",
        ticketStart: "1500",
        ticketEnd: "3499",
      }),
    ]);
  });

  it("draws a deterministic winner from assigned ticket ranges", async () => {
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: now,
    });
    const entries = [
      buildEntry("a", 1_500n, { ticketStart: 0n, ticketEnd: 1_499n }),
      buildEntry("b", 2_000n, { ticketStart: 1_500n, ticketEnd: 3_499n }),
    ];
    const drawnRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: now,
      winningTicket: 1_968n,
      winnerEntryId: "b",
      winnerUserId: "user-b",
      spinAngle: 202.4228,
    });
    const finalEntries = [
      entries[0],
      buildEntry("b", 2_000n, {
        ticketStart: 1_500n,
        ticketEnd: 3_499n,
        isWinner: true,
      }),
    ];
    const tx = {
      round: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(drawnRound),
      },
      entry: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue(finalEntries),
      },
    };
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(lockedRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.drawCurrentRoundForRoom("room-1");

    expect(tx.round.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          winningTicket: 1_968n,
          winnerEntryId: "b",
          winnerUserId: "user-b",
          spinAngle: 202.4228,
        }),
      }),
    );
    expect(result.winningTicket).toBe("1968");
    expect(result.winnerEntry).toEqual(
      expect.objectContaining({
        id: "b",
        isWinner: true,
      }),
    );
  });

  it("cancels a current round and reports idempotent hold refunds", async () => {
    const openRound = buildRound();
    const cancelledRound = buildRound({
      status: RoundStatus.CANCELLED,
      cancelledAt: now,
    });
    const entries = [buildEntry("a", 1_500n), buildEntry("b", 2_000n)];
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(openRound),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(cancelledRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
    };
    const walletsService = {
      refundEntryHoldsByEntryId: jest
        .fn()
        .mockResolvedValueOnce({
          entryId: "a",
          refunded: true,
          amount: 1_500n,
          reason: "REFUNDED",
        })
        .mockResolvedValueOnce({
          entryId: "b",
          refunded: false,
          amount: 2_000n,
          reason: "ALREADY_REFUNDED",
        }),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.cancelCurrentRoundForRoom("room-1");

    expect(walletsService.refundEntryHoldsByEntryId).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        refundedCount: 1,
        alreadyRefundedCount: 1,
        refundedAmount: "3500",
      }),
    );
  });

  it("settles a drawn round by crediting the winner once", async () => {
    const drawingRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: now,
      winningTicket: 1_968n,
      winnerEntryId: "b",
      winnerUserId: "user-b",
    });
    const settlingRound = buildRound({
      ...drawingRound,
      status: RoundStatus.SETTLING,
      settlingAt: now,
    });
    const completedRound = buildRound({
      ...settlingRound,
      status: RoundStatus.COMPLETED,
      completedAt: now,
    });
    const winnerEntry = buildEntry("b", 2_000n, {
      userId: "user-b",
      ticketStart: 1_500n,
      ticketEnd: 3_499n,
      isWinner: true,
    });
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(drawingRound),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce(settlingRound)
          .mockResolvedValueOnce(completedRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
        findUniqueOrThrow: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const walletsService = {
      creditRoundWin: jest.fn().mockResolvedValue({
        reused: false,
        wallet: { id: "wallet-1", balanceSnapshot: "3500" },
      }),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.settleCurrentRoundForRoom("room-1");

    expect(walletsService.creditRoundWin).toHaveBeenCalledTimes(1);
    expect(walletsService.creditRoundWin).toHaveBeenCalledWith({
      userId: "user-b",
      roundId: drawingRound.id,
      winnerEntryId: "b",
      amount: 3_500n,
    });
    expect(result).toEqual(
      expect.objectContaining({
        payoutAmount: "3500",
        reused: false,
      }),
    );
  });

  it("replays settlement for a completed round without another payout", async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: now,
      winningTicket: 1_968n,
      winnerEntryId: "b",
      winnerUserId: "user-b",
    });
    const winnerEntry = buildEntry("b", 2_000n, {
      userId: "user-b",
      ticketStart: 1_500n,
      ticketEnd: 3_499n,
      isWinner: true,
    });
    const prisma = {
      round: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(completedRound),
      },
      entry: {
        findUnique: jest.fn().mockResolvedValue(winnerEntry),
      },
    };
    const walletsService = {
      creditRoundWin: jest.fn(),
    };
    const service = new RoundsService(prisma as any, walletsService as any);

    const result = await service.settleCurrentRoundForRoom("room-1");

    expect(walletsService.creditRoundWin).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        payoutAmount: "3500",
        payout: null,
        reused: true,
      }),
    );
  });

  it("returns a latest-result fairness proof that verifies", async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: now,
      winningTicket: 1_968n,
      winnerEntryId: "b",
      winnerUserId: "user-b",
      spinAngle: 202.4228,
    });
    const entries = [
      buildEntry("a", 1_500n, {
        ticketStart: 0n,
        ticketEnd: 1_499n,
        user: {
          id: "user-a",
          username: "player-a",
          fullName: "Player A",
        },
      }),
      buildEntry("b", 2_000n, {
        userId: "user-b",
        ticketStart: 1_500n,
        ticketEnd: 3_499n,
        isWinner: true,
        user: {
          id: "user-b",
          username: "player-b",
          fullName: "Player B",
        },
      }),
    ];
    const prisma = {
      round: {
        findFirst: jest.fn().mockResolvedValue(completedRound),
      },
      entry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
    };
    const service = new RoundsService(prisma as any, {} as any);

    const result = await service.getLatestRoundResultForRoom("room-1");

    expect(result.fairness).toEqual(
      expect.objectContaining({
        seedHashMatches: true,
        winningTicketMatches: true,
        winnerTicketInsideRange: true,
        rangesCoverTotal: true,
        rangeError: null,
        recomputedWinningTicket: "1968",
      }),
    );
    expect(result.winnerEntry).toEqual(
      expect.objectContaining({
        id: "b",
        userId: "user-b",
      }),
    );
  });
});
