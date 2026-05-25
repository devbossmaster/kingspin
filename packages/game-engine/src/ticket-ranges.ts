export type EntryAmount = {
  userId: string;
  amount: bigint;
};

export type TicketRange = {
  userId: string;
  ticketStart: bigint;
  ticketEnd: bigint;
  amount: bigint;
};

export function buildTicketRanges(entries: EntryAmount[]): TicketRange[] {
  let cursor = 0n;

  return entries.map((entry) => {
    if (entry.amount <= 0n) {
      throw new Error("Entry amount must be positive.");
    }

    const ticketStart = cursor;
    const ticketEnd = cursor + entry.amount - 1n;

    cursor = ticketEnd + 1n;

    return {
      userId: entry.userId,
      ticketStart,
      ticketEnd,
      amount: entry.amount,
    };
  });
}

export function findWinnerByTicket(
  ranges: TicketRange[],
  winningTicket: bigint,
): TicketRange {
  const winner = ranges.find(
    (range) =>
      winningTicket >= range.ticketStart && winningTicket <= range.ticketEnd,
  );

  if (!winner) {
    throw new Error("Winning ticket is outside ticket ranges.");
  }

  return winner;
}
