import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@kingspin/contracts";

function normalizeGameSocketUrl(rawUrl: string) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("/game")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/game`;
    return url.toString().replace(/\/$/, "");
  } catch {
    return `${trimmed}/game`;
  }
}

const SOCKET_URL = normalizeGameSocketUrl(
  process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000/game",
);

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

function debugSocket(message: string, details?: unknown) {
  if (process.env.NODE_ENV === "production") return;

  if (details === undefined) {
    console.log(`[socket-client] ${message}`);
    return;
  }

  console.log(`[socket-client] ${message}`, details);
}

export function getGameSocket() {
  if (!socket) {
    debugSocket("creating socket", { SOCKET_URL });

    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      withCredentials: true,
    });

    socket.on("connect", () => {
      debugSocket("connected", {
        id: socket?.id,
        url: SOCKET_URL,
        transport: socket?.io.engine.transport.name,
      });
    });

    socket.on("connect_error", (error) => {
      debugSocket("connect_error", {
        message: error.message,
        url: SOCKET_URL,
      });
    });

    socket.on("disconnect", (reason) => {
      debugSocket("disconnected", { reason });
    });
  }

  return socket;
}

export function disconnectGameSocket() {
  socket?.disconnect();
  socket = null;
}


