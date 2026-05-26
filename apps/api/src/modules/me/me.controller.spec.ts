import { MeController } from "./me.controller";

const now = new Date("2026-05-26T12:00:00.000Z");

function buildUser() {
  return {
    id: "user-1",
    username: "player1",
    email: "player1@example.com",
    fullName: "Player One",
    role: "PLAYER",
    emailVerified: true,
  };
}

function buildWallet() {
  return {
    id: "wallet-1",
    userId: "user-1",
    type: "MAIN",
    balanceSnapshot: 1_000n,
    createdAt: now,
    updatedAt: now,
  };
}

describe("MeController", () => {
  it("returns only the current authenticated user", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(buildUser()),
      },
    };
    const controller = new MeController(prisma as any, {} as any);

    await expect(controller.me({ id: "user-1" })).resolves.toEqual(
      buildUser(),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
      }),
    );
  });

  it("returns the current user's main wallet", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(buildUser()),
      },
    };
    const walletsService = {
      ensureMainWalletForUserId: jest.fn().mockResolvedValue(buildWallet()),
    };
    const controller = new MeController(prisma as any, walletsService as any);

    await expect(controller.wallet({ id: "user-1" })).resolves.toEqual({
      user: buildUser(),
      wallet: {
        id: "wallet-1",
        userId: "user-1",
        type: "MAIN",
        balanceSnapshot: "1000",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });
    expect(walletsService.ensureMainWalletForUserId).toHaveBeenCalledWith(
      "user-1",
    );
  });
});
