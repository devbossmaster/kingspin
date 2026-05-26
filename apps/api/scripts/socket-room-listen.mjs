import { io } from "socket.io-client";

const roomId = process.argv[2];

if (!roomId) {
  console.error("Usage: node apps/api/scripts/socket-room-listen.mjs <roomId>");
  process.exit(1);
}

const socket = io("http://localhost:4000/game", {
  transports: ["websocket"],
  reconnection: true,
});

function log(event, payload) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`[${new Date().toISOString()}] ${event}`);
  console.dir(payload, { depth: null });
}

socket.on("connect", () => {
  console.log(`Connected socket: ${socket.id}`);
  socket.emit("room:join", { roomId }, (ack) => {
    log("room:join:ack", ack);
  });
});

socket.on("connect_error", (error) => {
  console.error("connect_error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("disconnect:", reason);
});

socket.on("round:state", (payload) => log("round:state", payload));
socket.on("round:updated", (payload) => log("round:updated", payload));
socket.on("round:locked", (payload) => log("round:locked", payload));
socket.on("round:spinning", (payload) => log("round:spinning", payload));
socket.on("round:settled", (payload) => log("round:settled", payload));
socket.on("room:player-joined", (payload) => log("room:player-joined", payload));
socket.on("room:player-left", (payload) => log("room:player-left", payload));
