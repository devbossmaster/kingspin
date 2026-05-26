import { HttpException } from "@nestjs/common";
import { SimpleRateLimitGuard } from "./simple-rate-limit.guard";

function buildContext(args: {
  method: string;
  url: string;
  ip?: string;
  response?: { setHeader: jest.Mock };
}) {
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => ({
        method: args.method,
        originalUrl: args.url,
        ip: args.ip ?? "127.0.0.1",
        headers: {},
      }),
      getResponse: () =>
        args.response ?? {
          setHeader: jest.fn(),
        },
    }),
  } as any;
}

describe("SimpleRateLimitGuard", () => {
  it("applies a stricter production limit to entry placement", () => {
    const guard = new SimpleRateLimitGuard({
      defaultWindowMs: 60_000,
      defaultMaxRequests: 1_000,
      isProduction: true,
    });

    for (let index = 0; index < 10; index += 1) {
      expect(
        guard.canActivate(
          buildContext({
            method: "POST",
            url: "/rooms/room-1/entries",
          }),
        ),
      ).toBe(true);
    }

    expect(() =>
      guard.canActivate(
        buildContext({
          method: "POST",
          url: "/rooms/room-1/entries",
        }),
      ),
    ).toThrow(HttpException);
  });

  it("keeps public live-state on a separate moderate bucket", () => {
    const guard = new SimpleRateLimitGuard({
      defaultWindowMs: 60_000,
      defaultMaxRequests: 1,
      isProduction: true,
    });

    expect(
      guard.canActivate(
        buildContext({
          method: "GET",
          url: "/rooms/room-1/live-state",
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        buildContext({
          method: "GET",
          url: "/rooms/room-1/live-state",
        }),
      ),
    ).toBe(true);
  });

  it("sets rate-limit response headers", () => {
    const response = {
      setHeader: jest.fn(),
    };
    const guard = new SimpleRateLimitGuard({
      defaultWindowMs: 60_000,
      defaultMaxRequests: 1_000,
      isProduction: true,
    });

    guard.canActivate(
      buildContext({
        method: "GET",
        url: "/rooms/room-1/live-state",
        response,
      }),
    );

    expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 120);
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-RateLimit-Remaining",
      119,
    );
  });
});
