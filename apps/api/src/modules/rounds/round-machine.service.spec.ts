import { ConflictException } from "@nestjs/common";
import { RoomStatus, RoundStatus } from "@kingspin/db";
import { RoundMachineService } from "./round-machine.service";

const now = new Date("2026-05-26T12:00:00.000Z");

function buildRound(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "round-1",
    roomId: "room-1",
    roundNumber: 1,
    status: RoundStatus.OPEN,
    openedAt: now,
    locksAt: new Date("2026-05-26T11:59:00.000Z"),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    totalEntryAmount: 0n,
    houseFeeAmount: 0n,
    payoutAmount: 0n,
    serverSeedHash: "hash",
    serverSeedReveal: null,
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
    idempotencyKey: "round:start:room-1:1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildService(args?: {
  lockResult?: { acquired: false; reason: "PROCESS_LOCKED" | "DATABASE_LOCKED" };
  currentRound?: ReturnType<typeof buildRound> | null;
  entryCount?: number;
  lockEvents?: string[];
}) {
  const prisma = {
    room: {
      findUnique: jest.fn().mockResolvedValue({
        id: "room-1",
        code: "room-one",
        status: RoomStatus.ACTIVE,
        roundDurationMs: 45_000,
      }),
      findMany: jest.fn(),
    },
    round: {
      findFirst: jest.fn().mockResolvedValue(args?.currentRound ?? null),
    },
    entry: {
      count: jest.fn().mockResolvedValue(args?.entryCount ?? 0),
    },
  };

  const roundsService = {
    toRoundSnapshot: jest.fn((round) => ({
      id: round.id,
      status: round.status,
      locksAt: round.locksAt?.toISOString() ?? null,
    })),
    startOpenRoundForRoom: jest.fn().mockResolvedValue({
      id: "round-new",
      status: RoundStatus.OPEN,
      locksAt: "2026-05-26T12:00:45.000Z",
    }),
    cancelCurrentRoundForRoom: jest.fn().mockResolvedValue({
      currentRound: {
        id: "round-1",
        status: RoundStatus.CANCELLED,
      },
    }),
    lockCurrentRoundForRoom: jest.fn(),
    drawCurrentRoundForRoom: jest.fn(),
    settleCurrentRoundForRoom: jest.fn(),
  };

  const roomGateway = {
    broadcastMachineResult: jest.fn(),
  };

  const roundMachineLockService = {
    withRoomTickLock: jest.fn(
      async (
        _roomId: string,
        work: () => Promise<Record<string, unknown>>,
      ) => {
        if (args?.lockResult) {
          return args.lockResult;
        }

        args?.lockEvents?.push("lock:start");
        return {
          acquired: true,
          result: await work().finally(() => {
            args?.lockEvents?.push("lock:end");
          }),
        };
      },
    ),
  };

  return {
    service: new RoundMachineService(
      prisma as any,
      roundsService as any,
      roomGateway as any,
      roundMachineLockService as any,
    ),
    prisma,
    roundsService,
    roomGateway,
    roundMachineLockService,
  };
}

describe("RoundMachineService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not create duplicate timers when a running room is started again", async () => {
    jest.useFakeTimers();
    const { service } = buildService();

    await service.startRoomMachine("room-1");
    await service.startRoomMachine("room-1");

    expect(jest.getTimerCount()).toBe(1);

    service.onModuleDestroy();
  });

  it("returns a leader skip when the room lock is already owned", async () => {
    const { service, prisma } = buildService({
      lockResult: {
        acquired: false,
        reason: "DATABASE_LOCKED",
      },
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(result).toEqual({
      action: "SKIPPED_NOT_LEADER",
      roomId: "room-1",
      message: "Another process is advancing this room.",
      force: false,
    });
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it("starts an open round through the lock-protected machine path", async () => {
    const { service, roundMachineLockService, roundsService } = buildService();

    const result = await service.advanceRoomOnce("room-1");

    expect(roundMachineLockService.withRoomTickLock).toHaveBeenCalledWith(
      "room-1",
      expect.any(Function),
    );
    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith("room-1");
    expect(result).toEqual(
      expect.objectContaining({
        action: "STARTED_OPEN_ROUND",
        roomId: "room-1",
      }),
    );
  });

  it("treats a raced round start conflict as a leader skip", async () => {
    const { service, roundsService } = buildService();

    roundsService.startOpenRoundForRoom.mockRejectedValueOnce(
      new ConflictException("Another round start is already running."),
    );

    const result = await service.advanceRoomOnce("room-1");

    expect(result).toEqual({
      action: "SKIPPED_NOT_LEADER",
      roomId: "room-1",
      message: "Another process is advancing this room.",
      force: false,
    });
  });

  it("still cancels an expired empty round and opens the next round", async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.cancelCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith("room-1");
    expect(result).toEqual(
      expect.objectContaining({
        action: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
        roomId: "room-1",
      }),
    );
  });

  it("broadcasts machine results after the lock-protected advance finishes", async () => {
    jest.useFakeTimers();
    const events: string[] = [];
    const { service, roomGateway } = buildService({ lockEvents: events });

    roomGateway.broadcastMachineResult.mockImplementation(async () => {
      events.push("broadcast");
    });

    (service as any).states.set("room-1", {
      roomId: "room-1",
      isRunning: true,
      tickCount: 0,
      lastAction: null,
      lastError: null,
      lastTickAt: null,
      nextTickAt: null,
    });

    await (service as any).tickRoom("room-1");

    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["lock:start", "lock:end", "broadcast"]);

    service.onModuleDestroy();
  });
});
