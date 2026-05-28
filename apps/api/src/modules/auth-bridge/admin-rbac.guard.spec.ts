import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@kingspin/db";
import { AdminRbacGuard, ADMIN_ROLES_METADATA_KEY } from "./admin-rbac.guard";

function contextFor(userId?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { id: userId } : undefined }),
    }),
    getHandler: () => "handler",
    getClass: () => "class",
  } as never;
}

describe("AdminRbacGuard", () => {
  it("allows owners for every admin route", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "admin-1",
          role: Role.OWNER,
          bannedAt: null,
        }),
      },
    };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.FINANCE]),
    } as unknown as Reflector;
    const guard = new AdminRbacGuard(reflector, prisma as never);

    await expect(guard.canActivate(contextFor("admin-1"))).resolves.toBe(true);
  });

  it("rejects players even when authenticated", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          role: Role.PLAYER,
          bannedAt: null,
        }),
      },
    };
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([Role.ADMIN])
        .mockName(ADMIN_ROLES_METADATA_KEY),
    } as unknown as Reflector;
    const guard = new AdminRbacGuard(reflector, prisma as never);

    await expect(guard.canActivate(contextFor("user-1"))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
