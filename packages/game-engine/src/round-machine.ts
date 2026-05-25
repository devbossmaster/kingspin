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
  COMPLETED: ["OPEN"],
  CANCELLED: ["OPEN"],
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
