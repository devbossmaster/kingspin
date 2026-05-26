import { RoundMachineLockService } from "./round-machine-lock.service";

function buildPrisma(locked = true) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ locked }])
      .mockResolvedValueOnce([{ unlocked: true }]),
  };

  return {
    tx,
    prisma: {
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
}

describe("RoundMachineLockService", () => {
  it("skips concurrent work for the same room inside one process", async () => {
    const { prisma } = buildPrisma();
    const service = new RoundMachineLockService(prisma as any);
    let release!: () => void;

    const first = service.withRoomTickLock(
      "room-1",
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("advanced");
        }),
    );

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
});
