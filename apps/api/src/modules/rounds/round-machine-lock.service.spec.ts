import { RoundMachineLockService } from "./round-machine-lock.service";

function buildPrisma(locked = true, events: string[] = []) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockImplementation(async () => {
        events.push("advisory-check");
        return [{ locked }];
      }),
  };

  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) => {
        events.push("transaction:start");
        const result = await callback(tx);
        events.push("transaction:end");
        return result;
      }),
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

  it("skips work when another database session owns the advisory lock", async () => {
    const { prisma, tx } = buildPrisma(false);
    const service = new RoundMachineLockService(prisma as any);
    const work = jest.fn();

    const result = await service.withRoomTickLock("room-1", work);

    expect(result).toEqual({
      acquired: false,
      reason: "DATABASE_LOCKED",
    });
    expect(work).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("commits the advisory transaction before running tick work", async () => {
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "transaction:start",
      "advisory-check",
      "transaction:end",
      "work",
    ]);
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
});
