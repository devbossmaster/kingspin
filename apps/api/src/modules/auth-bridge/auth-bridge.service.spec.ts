import { AuthBridgeService } from "./auth-bridge.service";
import { resetApiEnvForTesting } from "../../config/api-env";

describe("AuthBridgeService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("accepts x-dev-user-id only when local dev auth is explicitly enabled", async () => {
    const service = new AuthBridgeService();

    process.env.NODE_ENV = "development";
    process.env.ENABLE_DEV_AUTH = "true";
    resetApiEnvForTesting();

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
    resetApiEnvForTesting();

    await expect(
      service.validateRequest({
        headers: { "x-dev-user-id": "user-1" },
      }),
    ).resolves.toBeNull();
  });

  it("does not accept x-dev-user-id in production", async () => {
    const service = new AuthBridgeService();

    process.env.NODE_ENV = "production";
    process.env.ENABLE_DEV_AUTH = "false";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/kingspin";
    process.env.BETTER_AUTH_SECRET = "test-secret";
    resetApiEnvForTesting();

    await expect(
      service.validateRequest({
        headers: { "x-dev-user-id": "user-1" },
      }),
    ).resolves.toBeNull();
  });
});
