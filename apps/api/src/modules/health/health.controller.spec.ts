import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("HealthController", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            getHealth: jest.fn().mockReturnValue({
              status: "ok",
              service: "kingspin-api",
            }),
            getDbHealth: jest.fn().mockResolvedValue({
              status: "ok",
              database: { status: "ok" },
            }),
            getRedisHealth: jest.fn().mockResolvedValue({
              status: "ok",
              redis: { enabled: false, available: false },
            }),
            getRealtimeHealth: jest.fn().mockResolvedValue({
              status: "ok",
              metrics: {},
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves GET /health", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({
        status: "ok",
        service: "kingspin-api",
      });
  });

  it("serves GET /health/db", async () => {
    await request(app.getHttpServer())
      .get("/health/db")
      .expect(200)
      .expect({
        status: "ok",
        database: { status: "ok" },
      });
  });

  it("serves GET /health/realtime", async () => {
    await request(app.getHttpServer())
      .get("/health/realtime")
      .expect(200)
      .expect({
        status: "ok",
        metrics: {},
      });
  });
});
