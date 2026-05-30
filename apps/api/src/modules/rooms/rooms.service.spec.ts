import { BadRequestException } from "@nestjs/common";
import { RoomStatus, RoundStatus } from "@kingspin/db";
import { RoomsService } from "./rooms.service";

const now = new Date("2026-05-30T12:00:00.000Z");

function buildService(rows: unknown[] = []) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
  };
  const roundsService = {
    findCurrentRoundForRoom: jest.fn(),
  };

  return {
    service: new RoomsService(prisma as any, roundsService as any),
    prisma,
    roundsService,
  };
}

describe("RoomsService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("requires a category slug for public room summaries", async () => {
    const { service, prisma } = buildService();

    await expect(service.findActiveByCategorySlug("")).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("returns live room summary fields for cards without private fairness data", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const { service, prisma } = buildService([
      {
        roomId: "room-open",
        roomCategoryId: "category-1",
        roomCode: "PRO-A",
        roomName: "Pro A",
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: "FLEXIBLE_PROPORTIONAL",
        roomFixedEntryAmount: null,
        roomIsPermanent: true,
        roomMaxPlayers: 24,
        roomRoundDurationMs: 45_000,
        roomActivatedAt: new Date("2026-05-30T11:00:00.000Z"),
        roundId: "round-open",
        roundNumber: 7,
        roundStatus: RoundStatus.OPEN,
        roundLocksAt: new Date("2026-05-30T12:00:30.000Z"),
        roundTotalEntryAmount: 0n,
        roundPayoutAmount: 0n,
        entryCount: 2,
        playerCount: 2,
        liveEntryAmount: 150n,
      },
      {
        roomId: "room-completed",
        roomCategoryId: "category-1",
        roomCode: "PRO-B",
        roomName: null,
        roomStatus: RoomStatus.ACTIVE,
        roomGameMode: "FIXED_EQUAL_CHANCE",
        roomFixedEntryAmount: 50n,
        roomIsPermanent: true,
        roomMaxPlayers: 12,
        roomRoundDurationMs: 30_000,
        roomActivatedAt: null,
        roundId: "round-completed",
        roundNumber: 12,
        roundStatus: RoundStatus.COMPLETED,
        roundLocksAt: new Date("2026-05-30T11:59:00.000Z"),
        roundTotalEntryAmount: 300n,
        roundPayoutAmount: 285n,
        entryCount: 3,
        playerCount: 3,
        liveEntryAmount: 999n,
      },
    ]);

    const result = await service.findActiveByCategorySlug("pro-10-100");

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: "room-open",
        code: "PRO-A",
        name: "Pro A",
        status: RoomStatus.ACTIVE,
        gameMode: "FLEXIBLE_PROPORTIONAL",
        fixedEntryAmount: null,
        maxPlayers: 24,
        serverNow: now.toISOString(),
        currentRound: expect.objectContaining({
          id: "round-open",
          roundNumber: 7,
          status: RoundStatus.OPEN,
          locksAt: "2026-05-30T12:00:30.000Z",
          msUntilLock: 30_000,
          playerCount: 2,
          entryCount: 2,
          totalEntryAmount: "150",
          payoutAmount: "150",
          totalPool: "150",
        }),
      }),
      expect.objectContaining({
        id: "room-completed",
        code: "PRO-B",
        name: null,
        gameMode: "FIXED_EQUAL_CHANCE",
        fixedEntryAmount: "50",
        currentRound: expect.objectContaining({
          id: "round-completed",
          roundNumber: 12,
          status: RoundStatus.COMPLETED,
          msUntilLock: 0,
          totalEntryAmount: "300",
          payoutAmount: "285",
          totalPool: "285",
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("serverSeed");
  });
});
