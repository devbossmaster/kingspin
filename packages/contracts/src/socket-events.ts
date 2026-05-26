import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import { RoomLiveStateSchema } from "./rooms";

export const SOCKET_EVENTS = {
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROUND_STATE: "round:state",
  ROUND_UPDATED: "round:updated",
  ROUND_LOCKED: "round:locked",
  ROUND_SPINNING: "round:spinning",
  ROUND_SETTLED: "round:settled",
  ROOM_PLAYER_JOINED: "room:player-joined",
  ROOM_PLAYER_LEFT: "room:player-left",
} as const;

export const SocketRoomJoinPayloadSchema = z.object({
  roomId: z.string().min(1),
});

export const SocketRoomLeavePayloadSchema = z.object({
  roomId: z.string().min(1),
});

export const SocketRoomJoinAckSchema = z.object({
  ok: z.boolean(),
  roomId: z.string(),
  joinedAt: IsoDateStringSchema,
});

export const SocketRoomLeaveAckSchema = z.object({
  ok: z.boolean(),
  roomId: z.string(),
  leftAt: IsoDateStringSchema,
});

export const SocketRoundStateEventSchema = z.object({
  roomId: z.string(),
  reason: z.string(),
  snapshot: RoomLiveStateSchema.omit({ serverNow: true }).extend({
    serverNow: IsoDateStringSchema.optional(),
  }),
  emittedAt: IsoDateStringSchema,
});

export const SocketMachineEventSchema = z.object({
  roomId: z.string(),
  action: z.string(),
  result: z.unknown(),
  emittedAt: IsoDateStringSchema,
});

export const SocketPresenceEventSchema = z.object({
  roomId: z.string(),
  socketId: z.string(),
  joinedAt: IsoDateStringSchema.optional(),
  leftAt: IsoDateStringSchema.optional(),
});

export const ServerToClientEventsSchema = z.object({
  "round:state": SocketRoundStateEventSchema,
  "round:updated": SocketMachineEventSchema,
  "round:locked": SocketMachineEventSchema,
  "round:spinning": SocketMachineEventSchema,
  "round:settled": SocketMachineEventSchema,
  "room:player-joined": SocketPresenceEventSchema,
  "room:player-left": SocketPresenceEventSchema,
});

export type SocketRoomJoinPayload = z.infer<typeof SocketRoomJoinPayloadSchema>;
export type SocketRoomLeavePayload = z.infer<typeof SocketRoomLeavePayloadSchema>;
export type SocketRoomJoinAck = z.infer<typeof SocketRoomJoinAckSchema>;
export type SocketRoomLeaveAck = z.infer<typeof SocketRoomLeaveAckSchema>;
export type SocketRoundStateEvent = z.infer<typeof SocketRoundStateEventSchema>;
export type SocketMachineEvent = z.infer<typeof SocketMachineEventSchema>;
export type SocketPresenceEvent = z.infer<typeof SocketPresenceEventSchema>;

export type ServerToClientEvents = {
  "round:state": (payload: SocketRoundStateEvent) => void;
  "round:updated": (payload: SocketMachineEvent) => void;
  "round:locked": (payload: SocketMachineEvent) => void;
  "round:spinning": (payload: SocketMachineEvent) => void;
  "round:settled": (payload: SocketMachineEvent) => void;
  "room:player-joined": (payload: SocketPresenceEvent) => void;
  "room:player-left": (payload: SocketPresenceEvent) => void;
};

export type ClientToServerEvents = {
  "room:join": (
    payload: SocketRoomJoinPayload,
    ack?: (response: SocketRoomJoinAck) => void,
  ) => void;
  "room:leave": (
    payload: SocketRoomLeavePayload,
    ack?: (response: SocketRoomLeaveAck) => void,
  ) => void;
};
