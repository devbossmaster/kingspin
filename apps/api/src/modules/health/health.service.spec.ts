import { ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  it("returns basic API health", () => {
    const service = new HealthService({} as any);

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
    const service = new HealthService(prisma as any);

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
    const service = new HealthService(prisma as any);

    await expect(service.getDbHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
