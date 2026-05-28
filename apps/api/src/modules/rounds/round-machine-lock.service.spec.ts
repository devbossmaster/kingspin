import { RoundMachineLockService } from "./round-machine-lock.service";

function buildPrisma(locked = true, events: string[] = []) {
  const tx = {
    $queryRaw: jest.fn().mockImplementation(async () => {
      events.push("advisory-check");
      return [{ locked }];
    }),
  };

  return {
    tx,
    prisma: {
      $transaction: jest.fn(
        async (callback: (txClient: typeof tx) => unknown) => {
          events.push("transaction:start");
          const result = await callback(tx);
          events.push("transaction:end");
          return result;
        },
      ),
    },
  };
}

describe("RoundMachineLockService", () => {
  it("skips concurrent work for the same room inside one process", async () => {
    const { prisma } = buildPrisma();
    const service = new RoundMachineLockService(prisma as any);
    let release!: () => void;
    let markWorkStarted!: () => void;
    const workStarted = new Promise<void>((resolve) => {
      markWorkStarted = resolve;
    });

    const first = service.withRoomTickLock(
      "room-1",
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("advanced");
          markWorkStarted();
        }),
    );

    await workStarted;

    const blockedWork = jest.fn();
    const second = await service.withRoomTickLock("room-1", blockedWork);

    expect(second).toEqual({
      acquired: false,
      reason: "PROCESS_LOCKED",
    });
    expect(blockedWork).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toEqual({
      acquired: true,
      result: "advanced",
    });
  });

  it("does not use a database advisory transaction for the local fast path", async () => {
    const { prisma, tx } = buildPrisma(false);
    const service = new RoundMachineLockService(prisma as any);
    const work = jest.fn().mockResolvedValue("advanced");

    const result = await service.withRoomTickLock("room-1", work);

    expect(result).toEqual({
      acquired: true,
      result: "advanced",
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("runs tick work without holding a PostgreSQL transaction open", async () => {
    const events: string[] = [];
    const { prisma, tx } = buildPrisma(true, events);
    const service = new RoundMachineLockService(prisma as any);

    const result = await service.withRoomTickLock("room-1", async () => {
      events.push("work");
      return "advanced";
    });

    expect(result).toEqual({
      acquired: true,
      result: "advanced",
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(events).toEqual(["work"]);
  });

  it("allows different rooms to advance independently", async () => {
    const { prisma } = buildPrisma();
    const service = new RoundMachineLockService(prisma as any);
    let releaseRoomOne!: () => void;
    let markRoomOneWorkStarted!: () => void;
    const roomOneWorkStarted = new Promise<void>((resolve) => {
      markRoomOneWorkStarted = resolve;
    });

    const roomOne = service.withRoomTickLock(
      "room-1",
      () =>
        new Promise<string>((resolve) => {
          releaseRoomOne = () => resolve("room-1-advanced");
          markRoomOneWorkStarted();
        }),
    );

    await roomOneWorkStarted;

    const roomTwoWork = jest.fn().mockResolvedValue("room-2-advanced");
    const roomTwo = await service.withRoomTickLock("room-2", roomTwoWork);

    expect(roomTwo).toEqual({
      acquired: true,
      result: "room-2-advanced",
    });
    expect(roomTwoWork).toHaveBeenCalledTimes(1);

    releaseRoomOne();
    await expect(roomOne).resolves.toEqual({
      acquired: true,
      result: "room-1-advanced",
    });
  });

  it("uses Redis leadership when Redis is available", async () => {
    const { prisma } = buildPrisma();
    const lock = { key: "round-machine:room-1", value: "lock-value" };
    const redis = {
      isAvailable: jest.fn().mockReturnValue(true),
      acquireLock: jest.fn().mockResolvedValue(lock),
      releaseLock: jest.fn().mockResolvedValue(true),
    };
    const service = new RoundMachineLockService(prisma as any, redis as any);
    const work = jest.fn().mockResolvedValue("advanced");

    const result = await service.withRoomTickLock("room-1", work);

    expect(result).toEqual({
      acquired: true,
      result: "advanced",
    });
    expect(redis.acquireLock).toHaveBeenCalledWith("round-machine:room-1", 20_000);
    expect(redis.releaseLock).toHaveBeenCalledWith(lock);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("skips tick work when another instance owns the Redis lock", async () => {
    const { prisma } = buildPrisma();
    const redis = {
      isAvailable: jest.fn().mockReturnValue(true),
      acquireLock: jest.fn().mockResolvedValue(null),
      releaseLock: jest.fn(),
    };
    const service = new RoundMachineLockService(prisma as any, redis as any);
    const work = jest.fn();

    const result = await service.withRoomTickLock("room-1", work);

    expect(result).toEqual({
      acquired: false,
      reason: "REDIS_LOCKED",
    });
    expect(work).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });
});
