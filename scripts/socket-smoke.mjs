import { io } from "socket.io-client";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const ROOM_ID = process.env.ROOM_ID;

if (!ROOM_ID) {
  console.error("Missing ROOM_ID. Run with: $env:ROOM_ID='your-room-id'; node scripts/socket-smoke.mjs");
  process.exit(1);
}

console.log("Connecting to", `${API_URL}/game`);
console.log("Joining room", ROOM_ID);

const socket = io(`${API_URL}/game`, {
  transports: ["websocket", "polling"],
  withCredentials: true,
  reconnection: true,
  timeout: 10000,
});

socket.on("connect", () => {
  console.log("CONNECTED", socket.id);
  socket.emit("room:join", { roomId: ROOM_ID });
});

socket.on("connect_error", (error) => {
  console.error("CONNECT_ERROR", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("DISCONNECTED", reason);
});

const events = [
  "round:state",
  "round:updated",
  "round:locked",
  "round:spinning",
  "round:settled",
  "room:player-joined",
  "room:player-left",
];

for (const eventName of events) {
  socket.on(eventName, (payload) => {
    console.log(`EVENT ${eventName}`, JSON.stringify(payload, null, 2));
  });
}

setTimeout(() => {
  console.log("Still listening. Press Ctrl+C to stop.");
}, 3000);
