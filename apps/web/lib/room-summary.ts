import type { RoomListItem } from "./api-client";

export type PublicRoundPhase =
  | "ENTRY_OPEN"
  | "RANDOMIZING"
  | "SPINNING"
  | "RESULT";

type RoundPhaseSource = {
  phase?: string | null;
  phaseLabel?: string | null;
  status?: string | null;
  msUntilLock?: number | null;
  msUntilPhaseEnd?: number | null;
  msUntilNextRound?: number | null;
  locksAt?: string | null;
};

export const PUBLIC_ROUND_PHASE_LABELS: Record<PublicRoundPhase, string> = {
  ENTRY_OPEN: "ENTRY OPEN",
  RANDOMIZING: "DRAWING",
  SPINNING: "SPINNING",
  RESULT: "RESULT",
};

const STATUS_TO_PUBLIC_PHASE: Record<string, PublicRoundPhase> = {
  OPEN: "ENTRY_OPEN",
  LOCKED: "RANDOMIZING",
  DRAWING: "RANDOMIZING",
  SPINNING: "SPINNING",
  SETTLING: "RESULT",
  COMPLETED: "RESULT",
  CANCELLED: "RESULT",
};

function isPublicRoundPhase(
  value: string | null | undefined,
): value is PublicRoundPhase {
  return (
    value === "ENTRY_OPEN" ||
    value === "RANDOMIZING" ||
    value === "SPINNING" ||
    value === "RESULT"
  );
}

export function getPublicRoundPhase(
  roundOrStatus?: RoundPhaseSource | string | null,
): PublicRoundPhase | null {
  if (!roundOrStatus) {
    return null;
  }

  if (typeof roundOrStatus === "string") {
    return STATUS_TO_PUBLIC_PHASE[roundOrStatus] ?? null;
  }

  if (isPublicRoundPhase(roundOrStatus.phase)) {
    return roundOrStatus.phase;
  }

  return roundOrStatus.status
    ? (STATUS_TO_PUBLIC_PHASE[roundOrStatus.status] ?? null)
    : null;
}

export function getRoundPhaseLabel(
  roundOrStatus?: RoundPhaseSource | string | null,
) {
  if (roundOrStatus && typeof roundOrStatus !== "string") {
    const label = roundOrStatus.phaseLabel?.trim();

    if (label) {
      return label;
    }
  }

  const phase = getPublicRoundPhase(roundOrStatus);

  return phase ? PUBLIC_ROUND_PHASE_LABELS[phase] : "PREPARING";
}

export function getDisplayRoundPhaseLabel(
  roundOrStatus?: RoundPhaseSource | string | null,
  msUntilLock?: number | null,
) {
  void msUntilLock;

  return getRoundPhaseLabel(roundOrStatus);
}

export function getRoomActionLabel(
  roundOrStatus?: RoundPhaseSource | string | null,
) {
  switch (getPublicRoundPhase(roundOrStatus)) {
    case "ENTRY_OPEN":
      return "Join room";
    case "RANDOMIZING":
    case "SPINNING":
    case "RESULT":
      return "Watch live";
    default:
      return "Preparing";
  }
}

export function getRoundStatusTone(
  roundOrStatus?: RoundPhaseSource | string | null,
) {
  switch (getPublicRoundPhase(roundOrStatus)) {
    case "ENTRY_OPEN":
      return "lime";
    case "RANDOMIZING":
      return "teal";
    case "SPINNING":
      return "purple";
    case "RESULT":
      return "gold";
    default:
      return "muted";
  }
}

export function getRoomPool(room?: RoomListItem | null) {
  return (
    room?.currentRound?.netPrizeAmount ??
    room?.currentRound?.payoutAmount ??
    room?.currentRound?.totalPool ??
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

export function getAdjustedMsUntilPhaseEnd(
  room?: RoomListItem | null,
  clientNowMs = Date.now(),
) {
  const round = room?.currentRound;

  if (!round) {
    return 0;
  }

  let initialMs = round.msUntilPhaseEnd ?? round.msUntilLock ?? 0;

  if (!Number.isFinite(initialMs) || initialMs < 0) {
    initialMs = 0;
  }

  const receivedAtMs = room?.receivedAtMs ?? clientNowMs;
  const elapsedMs = Math.max(0, clientNowMs - receivedAtMs);

  return Math.max(0, initialMs - elapsedMs);
}

export function getAdjustedMsUntilLock(
  room?: RoomListItem | null,
  clientNowMs = Date.now(),
) {
  const round = room?.currentRound;

  if (!round || getPublicRoundPhase(round) !== "ENTRY_OPEN") {
    return 0;
  }

  let initialMs = round.msUntilPhaseEnd ?? round.msUntilLock ?? 0;

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