export const ROUND_STATUSES = [
  "OPEN",
  "LOCKED",
  "DRAWING",
  "SPINNING",
  "SETTLING",
  "COMPLETED",
  "CANCELLED",
] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

const allowedTransitions: Record<RoundStatus, RoundStatus[]> = {
  OPEN: ["LOCKED", "CANCELLED"],
  LOCKED: ["DRAWING", "CANCELLED"],

  DRAWING: ["SPINNING", "CANCELLED"],

  SPINNING: ["SETTLING", "CANCELLED"],
  SETTLING: ["COMPLETED"],

  // Terminal states. Next OPEN is a new round, not the same round.
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionRound(
  from: RoundStatus,
  to: RoundStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertRoundTransition(from: RoundStatus, to: RoundStatus) {
  if (!canTransitionRound(from, to)) {
    throw new Error(`Invalid round transition: ${from} -> ${to}`);
  }
}

export function isTerminalRoundStatus(status: RoundStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export function isActiveRoundStatus(status: RoundStatus): boolean {
  return !isTerminalRoundStatus(status);
}
