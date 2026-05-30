import { ConflictException } from "@nestjs/common";
import { RoomStatus, RoundStatus } from "@kingspin/db";
import { resetApiEnvForTesting } from "../../config/api-env";
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
  lockResult?: {
    acquired: false;
    reason: "PROCESS_LOCKED" | "DATABASE_LOCKED";
  };
  currentRound?: ReturnType<typeof buildRound> | null;
  latestRound?: ReturnType<typeof buildRound> | null;
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
      findFirst: jest.fn((query?: { where?: { status?: unknown } }) => {
        if (query?.where?.status) {
          return Promise.resolve(args?.currentRound ?? null);
        }

        return Promise.resolve(
          args?.latestRound ?? args?.currentRound ?? null,
        );
      }),
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
    startSpinningCurrentRoundForRoom: jest.fn(),
    settleCurrentRoundForRoom: jest.fn(),
  };

  roundsService.lockCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: "round-1",
      status: RoundStatus.LOCKED,
    },
  });
  roundsService.drawCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: "round-1",
      status: RoundStatus.DRAWING,
    },
  });
  roundsService.startSpinningCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: "round-1",
      status: RoundStatus.SPINNING,
    },
  });
  roundsService.settleCurrentRoundForRoom.mockResolvedValue({
    currentRound: {
      id: "round-1",
      status: RoundStatus.COMPLETED,
    },
  });

  const roomGateway = {
    broadcastMachineResult: jest.fn().mockResolvedValue(undefined),
    broadcastRoundState: jest.fn().mockResolvedValue(undefined),
  };

  const roundMachineLockService = {
    withRoomTickLock: jest.fn(
      async (_roomId: string, work: () => Promise<Record<string, unknown>>) => {
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
    delete process.env.ROUND_MACHINE_AUTO_START;
    delete process.env.APP_ENV;
    resetApiEnvForTesting();
  });

  it("does not auto-start machines unless ROUND_MACHINE_AUTO_START=true", () => {
    jest.useFakeTimers();
    process.env.APP_ENV = "local";
    process.env.ROUND_MACHINE_AUTO_START = "false";
    resetApiEnvForTesting();
    const { service, prisma } = buildService();

    service.onModuleInit();
    jest.advanceTimersByTime(2_000);

    expect(prisma.room.findMany).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it("does not create duplicate timers when a running room is started again", async () => {
    jest.useFakeTimers();
    const futureOpenRound = buildRound({
      locksAt: new Date("2026-05-26T12:00:30.000Z"),
    });
    const { service, roomGateway } = buildService({
      currentRound: futureOpenRound,
    });

    await service.startRoomMachine("room-1");
    await service.startRoomMachine("room-1");

    expect(jest.getTimerCount()).toBe(1);
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledTimes(1);
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      "room-1",
      "MACHINE_STARTED",
    );

    service.onModuleDestroy();
  });

  it("starts the machine by immediately advancing an expired empty open round", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const expiredRound = buildRound();
    const { service, roundsService, roomGateway } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    const status = await service.startRoomMachine("room-1");

    expect(roundsService.cancelCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith("room-1");
    expect(status).toEqual(
      expect.objectContaining({
        roomId: "room-1",
        isRunning: true,
        tickCount: 1,
        lastAction: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
        lastError: null,
        lastTickAt: now.toISOString(),
        nextTickAt: "2026-05-26T12:00:45.000Z",
      }),
    );
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      "room-1",
      "MACHINE_STARTED",
    );
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({
        action: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
        roomId: "room-1",
      }),
    );

    service.onModuleDestroy();
  });

  it("auto-starts active permanent rooms once when ROUND_MACHINE_AUTO_START=true", async () => {
    jest.useFakeTimers();
    process.env.APP_ENV = "local";
    process.env.ROUND_MACHINE_AUTO_START = "true";
    resetApiEnvForTesting();
    const { service, prisma, roomGateway } = buildService();

    prisma.room.findMany.mockResolvedValueOnce([
      { id: "room-1", code: "PRO-A" },
      { id: "room-2", code: "PRO-B" },
    ]);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(prisma.room.findMany).toHaveBeenCalledWith({
      where: {
        status: RoomStatus.ACTIVE,
        isPermanent: true,
      },
      select: {
        id: true,
        code: true,
      },
      orderBy: { code: "asc" },
    });
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledTimes(2);
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      "room-1",
      "MACHINE_STARTED",
    );
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      "room-2",
      "MACHINE_STARTED",
    );
    expect(jest.getTimerCount()).toBe(2);

    await service.startRoomMachine("room-1");

    expect(roomGateway.broadcastRoundState).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(2);

    service.onModuleDestroy();
  });

  it("auto-starts a permanent expired open room without leaving it frozen", async () => {
    jest.useFakeTimers().setSystemTime(now);
    process.env.APP_ENV = "local";
    process.env.ROUND_MACHINE_AUTO_START = "true";
    resetApiEnvForTesting();
    const expiredRound = buildRound();
    const { service, prisma, roundsService, roomGateway } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    prisma.room.findMany.mockResolvedValueOnce([
      { id: "room-1", code: "PRO-A" },
    ]);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);

    const status = await service.getRoomMachineStatus("room-1");

    expect(roundsService.cancelCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith("room-1");
    expect(status).toEqual(
      expect.objectContaining({
        isRunning: true,
        tickCount: 1,
        lastAction: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
        lastError: null,
      }),
    );
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({
        action: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
      }),
    );

    service.onModuleDestroy();
  });

  it("broadcasts round state when a running room machine is stopped", async () => {
    jest.useFakeTimers();
    const { service, roomGateway } = buildService();

    await service.startRoomMachine("room-1");
    await service.stopRoomMachine("room-1");

    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      "room-1",
      "MACHINE_STOPPED",
    );

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
    expect(roundsService.lockCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
        roomId: "room-1",
      }),
    );
  });

  it("advances once through the machine status and broadcast path", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const expiredRound = buildRound();
    const { service, roundsService, roomGateway } = buildService({
      currentRound: expiredRound,
      entryCount: 0,
    });

    const result = await service.advanceRoomMachineOnce("room-1");
    const status = await service.getRoomMachineStatus("room-1");

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
    expect(status).toEqual(
      expect.objectContaining({
        isRunning: false,
        tickCount: 1,
        lastAction: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
        lastError: null,
        lastTickAt: now.toISOString(),
        nextTickAt: null,
      }),
    );
    expect(roomGateway.broadcastMachineResult).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({
        action: "CANCELLED_EMPTY_ROUND_AND_STARTED_NEXT",
      }),
    );
  });

  it("refund-cancels an expired single-player round and opens the next round", async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 1,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.cancelCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith("room-1");
    expect(roundsService.lockCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(roundsService.drawCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "CANCELLED_SINGLE_PLAYER_ROUND_AND_STARTED_NEXT",
        roomId: "room-1",
      }),
    );
  });

  it("locks an expired open round once it has at least two entries", async () => {
    const expiredRound = buildRound();
    const { service, roundsService } = buildService({
      currentRound: expiredRound,
      entryCount: 2,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.lockCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(roundsService.cancelCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "LOCKED_ROUND",
        roomId: "room-1",
      }),
    );
  });

  it("draws after the locked phase elapses", async () => {
    const lockedRound = buildRound({
      status: RoundStatus.LOCKED,
      lockedAt: new Date("2026-05-26T11:59:00.000Z"),
    });
    const { service, roundsService } = buildService({
      currentRound: lockedRound,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.drawCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: "DREW_ROUND",
        roomId: "room-1",
      }),
    );
  });

  it("starts spinning after the drawing phase elapses", async () => {
    const drawingRound = buildRound({
      status: RoundStatus.DRAWING,
      drawingAt: new Date("2026-05-26T11:59:00.000Z"),
      winningTicket: 10n,
      winnerEntryId: "entry-1",
      winnerUserId: "user-1",
      spinAngle: 42,
    });
    const { service, roundsService } = buildService({
      currentRound: drawingRound,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.startSpinningCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(roundsService.settleCurrentRoundForRoom).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "STARTED_SPINNING_ROUND",
        roomId: "room-1",
      }),
    );
  });

  it("settles after the spinning phase elapses", async () => {
    const spinningRound = buildRound({
      status: RoundStatus.SPINNING,
      spinningAt: new Date("2026-05-26T11:59:00.000Z"),
      winningTicket: 10n,
      winnerEntryId: "entry-1",
      winnerUserId: "user-1",
      spinAngle: 42,
    });
    const { service, roundsService } = buildService({
      currentRound: spinningRound,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.settleCurrentRoundForRoom).toHaveBeenCalledWith(
      "room-1",
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: "SETTLED_ROUND",
        roomId: "room-1",
      }),
    );
  });

  it("starts the next open round after completed-round cooldown", async () => {
    const completedRound = buildRound({
      status: RoundStatus.COMPLETED,
      completedAt: new Date("2026-05-26T11:59:00.000Z"),
    });
    const { service, roundsService } = buildService({
      currentRound: null,
      latestRound: completedRound,
    });

    const result = await service.advanceRoomOnce("room-1");

    expect(roundsService.startOpenRoundForRoom).toHaveBeenCalledWith("room-1");
    expect(result).toEqual(
      expect.objectContaining({
        action: "STARTED_NEXT_ROUND_AFTER_COMPLETION",
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
