import { AuthBridgeService } from "./auth-bridge.service";
import { resetApiEnvForTesting } from "../../config/api-env";

describe("AuthBridgeService", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetApiEnvForTesting();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    resetApiEnvForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function setProductionEnv() {
    process.env.NODE_ENV = "production";
    process.env.WEB_URL = "https://app.example.com";
    process.env.BETTER_AUTH_URL = "https://app.example.com";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/kingspin";
    process.env.DIRECT_URL = "postgresql://user:pass@localhost:5432/kingspin";
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.ADMIN_DEV_KEY = "admin-secret";
    process.env.RESEND_API_KEY = "resend-test";
    process.env.EMAIL_FROM = "SpinPro <auth@example.com>";
    process.env.ENABLE_DEV_AUTH = "false";
  }

  it("accepts x-dev-user-id only when local dev auth is explicitly enabled", async () => {
    const service = new AuthBridgeService();

    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_AUTH = "true";

    await expect(
      service.validateRequest({
        headers: { "x-dev-user-id": "user-1" },
      }),
    ).resolves.toEqual({ id: "user-1" });
  });

  it("fails closed when local dev auth is not enabled", async () => {
    const service = new AuthBridgeService();

    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_AUTH = "false";

    await expect(
      service.validateRequest({
        headers: { "x-dev-user-id": "user-1" },
      }),
    ).resolves.toBeNull();
  });

  it("does not accept x-dev-user-id in production", async () => {
    const service = new AuthBridgeService();

    setProductionEnv();

    await expect(
      service.validateRequest({
        headers: { "x-dev-user-id": "user-1" },
      }),
    ).resolves.toBeNull();
  });

  it("validates a real Better Auth session through the web auth endpoint", async () => {
    const service = new AuthBridgeService();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: "user-1" } }),
    });

    setProductionEnv();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.validateRequest({
        headers: {
          cookie: "better-auth.session_token=signed-token",
          "user-agent": "jest",
          "x-forwarded-for": "203.0.113.10",
        },
      }),
    ).resolves.toEqual({ id: "user-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://app.example.com/api/auth/get-session?disableRefresh=true",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      accept: "application/json",
      cookie: "better-auth.session_token=signed-token",
      "user-agent": "jest",
      "x-forwarded-for": "203.0.113.10",
    });
  });

  it("fails closed when Better Auth session validation is unavailable", async () => {
    const service = new AuthBridgeService();

    setProductionEnv();
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as
      typeof fetch;

    await expect(
      service.validateRequest({
        headers: { cookie: "better-auth.session_token=signed-token" },
      }),
    ).resolves.toBeNull();
  });
});
