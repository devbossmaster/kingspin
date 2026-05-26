import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@kingspin/contracts";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000/game";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getGameSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnection: true,
    });
  }

  return socket;
}

export function disconnectGameSocket() {
  socket?.disconnect();
  socket = null;
}
