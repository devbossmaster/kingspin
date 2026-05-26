export function calculateSpinAngle(
  winningTicket: bigint,
  totalTickets: bigint,
): number {
  if (totalTickets <= 0n) {
    return 0;
  }

  if (winningTicket < 0n || winningTicket >= totalTickets) {
    throw new Error("winningTicket must be within total ticket range.");
  }

  const scaled = (winningTicket * 3_600_000n) / totalTickets;

  return Number(scaled) / 10_000;
}
