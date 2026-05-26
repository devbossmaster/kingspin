import { UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";

function buildContext() {
  const request: { user?: unknown; authUser?: unknown } = {};

  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any,
  };
}

describe("AuthGuard", () => {
  it("rejects unauthenticated requests", async () => {
    const guard = new AuthGuard({
      validateRequest: jest.fn().mockResolvedValue(null),
    } as any);

    const { context } = buildContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("attaches the authenticated bridge user to the request", async () => {
    const guard = new AuthGuard({
      validateRequest: jest.fn().mockResolvedValue({ id: "user-1" }),
    } as any);

    const { context, request } = buildContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: "user-1" });
    expect(request.authUser).toEqual({ id: "user-1" });
  });
});
