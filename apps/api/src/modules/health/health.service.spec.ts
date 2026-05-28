import { ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  function buildService(prisma: any) {
    return new HealthService(
      prisma,
      {
        ping: jest.fn().mockResolvedValue({
          enabled: false,
          available: false,
          latencyMs: null,
        }),
      } as any,
      {
        snapshot: jest.fn().mockReturnValue({
          liveStateBuildCount: 0,
        }),
      } as any,
    );
  }

  it("returns basic API health", () => {
    const service = buildService({} as any);

    expect(service.getHealth()).toEqual(
      expect.objectContaining({
        status: "ok",
        service: "kingspin-api",
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String),
      }),
    );
  });

  it("checks database connectivity with Prisma", async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    };
    const service = buildService(prisma as any);

    await expect(service.getDbHealth()).resolves.toEqual(
      expect.objectContaining({
        status: "ok",
        database: expect.objectContaining({
          status: "ok",
          latencyMs: expect.any(Number),
        }),
      }),
    );
  });

  it("returns a clean service-unavailable error when Prisma fails", async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error("db down")),
    };
    const service = buildService(prisma as any);

    await expect(service.getDbHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("reports Redis and realtime metric health", async () => {
    const service = buildService({} as any);

    await expect(service.getRealtimeHealth()).resolves.toEqual(
      expect.objectContaining({
        status: "ok",
        redis: expect.objectContaining({
          enabled: false,
          available: false,
        }),
        metrics: expect.any(Object),
      }),
    );
  });
});
