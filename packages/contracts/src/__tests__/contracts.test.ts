import { describe, expect, it } from "vitest";
import {
  CurrentUserSchema,
  LatestRoundResultSchema,
  MeWalletSchema,
  PlaceEntrySchema,
  RoomLiveStateSchema,
  SocketMachineEventSchema,
  SocketPresenceEventSchema,
  SocketRoundStateEventSchema,
} from "../index";

describe("contracts", () => {
  it("rejects invalid place entry amount", () => {
    const result = PlaceEntrySchema.safeParse({
      amount: 0,
    });

    expect(result.success).toBe(false);
  });

  it("accepts valid production place entry", () => {
    const result = PlaceEntrySchema.safeParse({
      amount: 1000,
      idempotencyKey: "entry-1",
    });

    expect(result.success).toBe(true);
  });

  it("rejects identity fields in production place entry", () => {
    const result = PlaceEntrySchema.safeParse({
      amount: 1000,
      userId: "user-1",
      playerKey: "player-1",
      walletId: "wallet-1",
    });

    expect(result.success).toBe(false);
  });

  it("accepts current user and me wallet shapes", () => {
    const user = {
      id: "user-1",
      username: "player1",
      email: "player1@example.com",
      fullName: "Player One",
      role: "PLAYER",
      emailVerified: true,
    };

    expect(CurrentUserSchema.safeParse(user).success).toBe(true);
    expect(
      MeWalletSchema.safeParse({
        user,
        wallet: {
          id: "wallet-1",
          userId: "user-1",
          type: "MAIN",
          balanceSnapshot: "1000",
          createdAt: "2026-05-26T11:31:15.289Z",
          updatedAt: "2026-05-26T11:31:15.289Z",
        },
      }).success,
    ).toBe(true);
  });

  it("accepts a public room live-state shape", () => {
    const result = RoomLiveStateSchema.safeParse({
      serverNow: "2026-05-26T11:31:15.289Z",
      room: {
        id: "room-1",
        categoryId: "cat-1",
        code: "A01",
        name: "Jemaw 1 Arena A01",
        status: "ACTIVE",
        gameMode: "FLEXIBLE_PROPORTIONAL",
        fixedEntryAmount: null,
        isPermanent: true,
        maxPlayers: 24,
        roundDurationMs: 45000,
        activatedAt: "2026-05-25T07:29:17.735Z",
      },
      category: {
        id: "cat-1",
        name: "Jemaw 1",
        slug: "jemaw-1",
        minEntryAmount: "1000",
        maxEntryAmount: "5000",
        maxPlayers: 24,
        roundDurationMs: 45000,
      },
      currentRound: {
        id: "round-1",
        roomId: "room-1",
        roundNumber: 1,
        status: "OPEN",
        totalEntryAmount: "0",
        houseFeeAmount: "0",
        payoutAmount: "0",
        openedAt: "2026-05-26T11:32:58.702Z",
        locksAt: "2026-05-26T11:33:43.702Z",
        lockedAt: null,
        drawingAt: null,
        spinningAt: null,
        settlingAt: null,
        completedAt: null,
        cancelledAt: null,
        serverSeedHash: "hash",
        winningTicket: null,
        winnerUserId: null,
        winnerEntryId: null,
        spinAngle: null,
        msUntilLock: 30332,
        phase: "ENTRY_OPEN",
        phaseLabel: "ENTRY OPEN",
        msUntilPhaseEnd: 30332,
        msUntilNextRound: null,
        resultReason: null,
      },
      entries: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts latest round result proof shape", () => {
    const result = LatestRoundResultSchema.safeParse({
      round: {
        id: "round-1",
        roomId: "room-1",
        roundNumber: 1,
        status: "COMPLETED",
        totalEntryAmount: "1000",
        houseFeeAmount: "0",
        payoutAmount: "1000",
        openedAt: "2026-05-26T11:14:53.225Z",
        locksAt: "2026-05-26T11:15:38.225Z",
        lockedAt: "2026-05-26T11:23:39.941Z",
        drawingAt: "2026-05-26T11:23:47.462Z",
        spinningAt: null,
        settlingAt: "2026-05-26T11:23:52.602Z",
        completedAt: "2026-05-26T11:23:59.27Z",
        cancelledAt: null,
        serverSeedHash: "hash",
        winningTicket: "557",
        winnerUserId: "user-1",
        winnerEntryId: "entry-1",
        spinAngle: 200.52,
      },
      serverSeedReveal: "seed",
      fairness: {
        serverSeedHash: "hash",
        recomputedServerSeedHash: "hash",
        seedHashMatches: true,
        drawInput: "seed:round-1:1:1000",
        drawHash: "draw-hash",
        recomputedWinningTicket: "557",
        winningTicketMatches: true,
        winnerTicketInsideRange: true,
        rangesCoverTotal: true,
        rangeError: null,
      },
      winnerEntry: {
        id: "entry-1",
        roundId: "round-1",
        userId: "user-1",
        amount: "1000",
        ticketStart: "0",
        ticketEnd: "999",
        isWinner: true,
        createdAt: "2026-05-26T11:22:54.346Z",
        updatedAt: "2026-05-26T11:23:47.911Z",
      },
      entries: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts socket round state event shape", () => {
    const result = SocketRoundStateEventSchema.safeParse({
      roomId: "room-1",
      reason: "JOINED_ROOM",
      emittedAt: "2026-05-26T11:23:08.262Z",
      snapshot: {
        room: {
          id: "room-1",
          categoryId: "cat-1",
          code: "A01",
          name: "Jemaw 1 Arena A01",
          status: "ACTIVE",
          gameMode: "FLEXIBLE_PROPORTIONAL",
          fixedEntryAmount: null,
          isPermanent: true,
          maxPlayers: 24,
          roundDurationMs: 45000,
          activatedAt: "2026-05-25T07:29:17.735Z",
        },
        category: {
          id: "cat-1",
          name: "Jemaw 1",
          slug: "jemaw-1",
          minEntryAmount: "1000",
          maxEntryAmount: "5000",
          maxPlayers: 24,
          roundDurationMs: 45000,
        },
        currentRound: null,
        entries: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts socket machine and presence event shapes", () => {
    expect(
      SocketMachineEventSchema.safeParse({
        roomId: "room-1",
        action: "LOCKED_ROUND",
        result: { ok: true },
        emittedAt: "2026-05-26T11:23:08.262Z",
      }).success,
    ).toBe(true);

    expect(
      SocketPresenceEventSchema.safeParse({
        roomId: "room-1",
        socketId: "socket-1",
        joinedAt: "2026-05-26T11:23:08.262Z",
      }).success,
    ).toBe(true);
  });
});
