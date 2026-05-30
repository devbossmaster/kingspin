import type { RoomListItem } from "./api-client";

export const ROUND_PHASE_LABELS: Record<string, string> = {
  OPEN: "Entries open",
  LOCKED: "Assigning tickets",
  DRAWING: "Selecting winner",
  SPINNING: "Wheel spinning",
  SETTLING: "Finalizing payout",
  COMPLETED: "Next round soon",
  CANCELLED: "Skipped/refunded",
};

export function getRoundPhaseLabel(status?: string | null) {
  if (!status) {
    return "Waiting";
  }

  return ROUND_PHASE_LABELS[status] ?? status;
}

export function getRoundStatusTone(status?: string | null) {
  switch (status) {
    case "OPEN":
      return "lime";
    case "LOCKED":
    case "DRAWING":
    case "SPINNING":
      return "teal";
    case "SETTLING":
      return "gold";
    case "COMPLETED":
      return "purple";
    case "CANCELLED":
      return "danger";
    default:
      return "muted";
  }
}

export function getRoomPool(room?: RoomListItem | null) {
  return (
    room?.currentRound?.totalPool ??
    room?.currentRound?.payoutAmount ??
    room?.currentRound?.totalEntryAmount ??
    "0"
  );
}

export function getRoomPlayerCount(room?: RoomListItem | null) {
  return room?.currentRound?.playerCount ?? 0;
}

export function getRoomEntryCount(room?: RoomListItem | null) {
  return room?.currentRound?.entryCount ?? room?.currentRound?.playerCount ?? 0;
}

export function getAdjustedMsUntilLock(
  room?: RoomListItem | null,
  clientNowMs = Date.now(),
) {
  const round = room?.currentRound;

  if (!round || round.status !== "OPEN") {
    return 0;
  }

  let initialMs = round.msUntilLock ?? 0;

  if ((!Number.isFinite(initialMs) || initialMs <= 0) && round.locksAt) {
    const locksAtMs = Date.parse(round.locksAt);
    const serverNowMs = room?.serverNow ? Date.parse(room.serverNow) : NaN;

    if (Number.isFinite(locksAtMs) && Number.isFinite(serverNowMs)) {
      initialMs = Math.max(0, locksAtMs - serverNowMs);
    }
  }

  const receivedAtMs = room?.receivedAtMs ?? clientNowMs;
  const elapsedMs = Math.max(0, clientNowMs - receivedAtMs);

  return Math.max(0, initialMs - elapsedMs);
}

export function formatLockCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
