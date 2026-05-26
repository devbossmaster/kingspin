import { UnauthorizedException } from "@nestjs/common";
import { resetApiEnvForTesting } from "../config/api-env";
import { AdminDevGuard } from "./admin-dev.guard";

function buildContext(headers: Record<string, string | undefined> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as any;
}

describe("AdminDevGuard", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("rejects requests when ADMIN_DEV_KEY is missing", () => {
    delete process.env.ADMIN_DEV_KEY;
    resetApiEnvForTesting();

    expect(() => new AdminDevGuard().canActivate(buildContext())).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects requests with the wrong admin development key", () => {
    process.env.ADMIN_DEV_KEY = "secret";
    resetApiEnvForTesting();

    expect(() =>
      new AdminDevGuard().canActivate(
        buildContext({ "x-admin-dev-key": "wrong" }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("accepts requests with the configured admin development key", () => {
    process.env.ADMIN_DEV_KEY = "secret";
    resetApiEnvForTesting();

    expect(
      new AdminDevGuard().canActivate(
        buildContext({ "x-admin-dev-key": "secret" }),
      ),
    ).toBe(true);
  });
});
