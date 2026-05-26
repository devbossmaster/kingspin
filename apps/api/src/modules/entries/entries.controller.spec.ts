import { INestApplication, RequestMethod } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import request from "supertest";
import { RoomGateway } from "../../gateways/room.gateway";
import { AuthBridgeService } from "../auth-bridge/auth-bridge.service";
import { AuthGuard } from "../auth-bridge/auth.guard";
import { EntriesController } from "./entries.controller";
import { EntriesService } from "./entries.service";

describe("EntriesController", () => {
  it("registers the production-shaped entry route", () => {
    expect(Reflect.getMetadata(PATH_METADATA, EntriesController)).toBe(
      "rooms/:roomId/entries",
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        EntriesController.prototype.placeEntry,
      ),
    ).toBe("/");
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        EntriesController.prototype.placeEntry,
      ),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        EntriesController.prototype.placeEntry,
      ),
    ).toContain(AuthGuard);
  });

  it("uses the current authenticated user id and ignores body identity fields", async () => {
    const entriesService = {
      placeEntryForUser: jest.fn().mockResolvedValue({
        reused: false,
      }),
    };
    const roomGateway = {
      broadcastRoundState: jest.fn(),
    };
    const controller = new EntriesController(
      entriesService as any,
      roomGateway as any,
    );

    await controller.placeEntry(
      "room-1",
      { id: "user-1" },
      {
        amount: 1_000,
        idempotencyKey: "entry-key-1",
        userId: "evil-user",
        playerKey: "evil-player",
        walletId: "wallet-1",
      } as any,
    );

    expect(entriesService.placeEntryForUser).toHaveBeenCalledWith({
      roomId: "room-1",
      userId: "user-1",
      amount: 1_000,
      idempotencyKey: "entry-key-1",
    });
    expect(roomGateway.broadcastRoundState).toHaveBeenCalledWith(
      "room-1",
      "ENTRY_PLACED",
    );
  });
});

describe("EntriesController HTTP", () => {
  async function buildApp(args?: {
    authenticatedUser?: { id: string } | null;
    entriesService?: Partial<EntriesService>;
  }) {
    const moduleRef = await Test.createTestingModule({
      controllers: [EntriesController],
      providers: [
        {
          provide: EntriesService,
          useValue: {
            placeEntryForUser: jest.fn().mockResolvedValue({ reused: false }),
            ...args?.entriesService,
          },
        },
        {
          provide: RoomGateway,
          useValue: {
            broadcastRoundState: jest.fn(),
          },
        },
        {
          provide: AuthBridgeService,
          useValue: {
            validateRequest: jest
              .fn()
              .mockResolvedValue(args?.authenticatedUser ?? null),
          },
        },
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    return {
      app,
      entriesService: moduleRef.get(EntriesService) as jest.Mocked<EntriesService>,
    };
  }

  let app: INestApplication | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("rejects unauthenticated production-shaped entry requests", async () => {
    const testApp = await buildApp();
    app = testApp.app;

    await request(app.getHttpServer())
      .post("/rooms/room-1/entries")
      .send({ amount: 1_000 })
      .expect(401);
  });

  it("rejects identity fields on the production entry route body", async () => {
    const testApp = await buildApp({
      authenticatedUser: { id: "user-1" },
    });
    app = testApp.app;

    await request(app.getHttpServer())
      .post("/rooms/room-1/entries")
      .send({
        amount: 1_000,
        userId: "evil-user",
        playerKey: "evil-player",
      })
      .expect(400);

    expect(testApp.entriesService.placeEntryForUser).not.toHaveBeenCalled();
  });

  it("does not register the removed public dev-place route", async () => {
    const testApp = await buildApp({
      authenticatedUser: { id: "user-1" },
    });
    app = testApp.app;

    await request(app.getHttpServer())
      .post("/rooms/room-1/entries/dev-place")
      .send({ amount: 1_000, playerKey: "player-1" })
      .expect(404);
  });
});
