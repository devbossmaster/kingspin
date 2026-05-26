import { WsException } from "@nestjs/websockets";
import { SOCKET_EVENTS } from "@kingspin/contracts";
import { RoomStatus, RoundStatus } from "@kingspin/db";
import { RoomGateway } from "./room.gateway";

const now = new Date("2026-05-26T12:00:00.000Z");

function buildRoom() {
  return {
    id: "room-1",
    categoryId: "category-1",
    code: "room-one",
    name: "Room One",
    status: RoomStatus.ACTIVE,
    isPermanent: true,
    maxPlayers: 20,
    roundDurationMs: 45_000,
    activatedAt: now,
    category: {
      id: "category-1",
      name: "Starter",
      slug: "starter",
      minEntryAmount: 1_000n,
      maxEntryAmount: 5_000n,
      maxPlayers: 20,
      roundDurationMs: 45_000,
    },
  };
}

function buildRound() {
  return {
    id: "round-1",
    roomId: "room-1",
    roundNumber: 1,
    status: RoundStatus.OPEN,
    totalEntryAmount: 0n,
    houseFeeAmount: 0n,
    payoutAmount: 0n,
    openedAt: now,
    locksAt: new Date("2026-05-26T12:00:45.000Z"),
    lockedAt: null,
    drawingAt: null,
    spinningAt: null,
    settlingAt: null,
    completedAt: null,
    cancelledAt: null,
    serverSeedHash: "hash",
    winningTicket: null,
    winnerUserId: null,
    winnerEntryId: null,
    spinAngle: null,
  };
}

function buildPrisma() {
  const room = buildRoom();

  return {
    room: {
      findUnique: jest.fn((args: { select?: unknown }) => {
        if (args.select) {
          return Promise.resolve({ id: room.id });
        }

        return Promise.resolve(room);
      }),
    },
    round: {
      findFirst: jest.fn().mockResolvedValue(buildRound()),
    },
    entry: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function buildClient() {
  const roomEmitter = {
    emit: jest.fn(),
  };
  const client = {
    id: "socket-1",
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    to: jest.fn().mockReturnValue(roomEmitter),
  };

  return { client, roomEmitter };
}

describe("RoomGateway", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("validates room:join, joins the socket room, and emits round:state", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const prisma = buildPrisma();
    const gateway = new RoomGateway(prisma as any);
    const { client, roomEmitter } = buildClient();

    const ack = await gateway.handleJoin(client as any, { roomId: "room-1" });

    expect(client.join).toHaveBeenCalledWith("room-1");
    expect(client.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_STATE,
      expect.objectContaining({
        roomId: "room-1",
        reason: "JOINED_ROOM",
        snapshot: expect.objectContaining({
          currentRound: expect.objectContaining({
            id: "round-1",
            msUntilLock: 45_000,
          }),
        }),
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROOM_PLAYER_JOINED,
      expect.objectContaining({
        roomId: "room-1",
        socketId: "socket-1",
      }),
    );
    expect(ack).toEqual(
      expect.objectContaining({
        ok: true,
        roomId: "room-1",
      }),
    );
  });

  it("rejects invalid room:join payloads before touching the database", async () => {
    const prisma = buildPrisma();
    const gateway = new RoomGateway(prisma as any);
    const { client } = buildClient();

    await expect(gateway.handleJoin(client as any, {})).rejects.toBeInstanceOf(
      WsException,
    );

    expect(prisma.room.findUnique).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it("handles room:leave safely and emits player-left presence", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const gateway = new RoomGateway(buildPrisma() as any);
    const { client, roomEmitter } = buildClient();

    const ack = await gateway.handleLeave(client as any, { roomId: "room-1" });

    expect(client.leave).toHaveBeenCalledWith("room-1");
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROOM_PLAYER_LEFT,
      expect.objectContaining({
        roomId: "room-1",
        socketId: "socket-1",
        leftAt: now.toISOString(),
      }),
    );
    expect(ack).toEqual({
      ok: true,
      roomId: "room-1",
      leftAt: now.toISOString(),
    });
  });

  it("broadcasts round lifecycle events with contract event names", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const gateway = new RoomGateway(buildPrisma() as any);
    const roomEmitter = {
      emit: jest.fn(),
    };

    gateway.server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    } as any;

    await gateway.broadcastMachineResult("room-1", {
      action: "LOCKED_ROUND",
      resultId: 1n,
    });

    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_STATE,
      expect.objectContaining({
        roomId: "room-1",
        reason: "MACHINE_ADVANCED",
      }),
    );
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      SOCKET_EVENTS.ROUND_LOCKED,
      expect.objectContaining({
        roomId: "room-1",
        action: "LOCKED_ROUND",
        result: expect.objectContaining({
          resultId: "1",
        }),
      }),
    );
  });
});
