export type TicketRangeInput = {
  id: string;
  userId: string;
  amount: bigint;
};

export type TicketRange = TicketRangeInput & {
  ticketStart: bigint;
  ticketEnd: bigint;
};

export type TicketRangeVerification = {
  rangesCoverTotal: boolean;
  rangeError: string | null;
};

export function buildTicketRanges(entries: TicketRangeInput[]): TicketRange[] {
  let cursor = 0n;

  return entries.map((entry) => {
    if (entry.amount <= 0n) {
      throw new Error(`Entry ${entry.id} amount must be greater than zero.`);
    }

    const ticketStart = cursor;
    const ticketEnd = cursor + entry.amount - 1n;

    cursor = ticketEnd + 1n;

    return {
      ...entry,
      ticketStart,
      ticketEnd,
    };
  });
}

export function verifyTicketRanges(
  ranges: TicketRange[],
  expectedTotal: bigint,
): TicketRangeVerification {
  let cursor = 0n;

  for (const range of ranges) {
    if (range.amount <= 0n) {
      return {
        rangesCoverTotal: false,
        rangeError: `Entry ${range.id} amount must be greater than zero.`,
      };
    }

    if (range.ticketStart !== cursor) {
      return {
        rangesCoverTotal: false,
        rangeError: `Entry ${range.id} starts at ${range.ticketStart.toString()} but expected ${cursor.toString()}.`,
      };
    }

    const expectedEnd = cursor + range.amount - 1n;

    if (range.ticketEnd !== expectedEnd) {
      return {
        rangesCoverTotal: false,
        rangeError: `Entry ${range.id} ends at ${range.ticketEnd.toString()} but expected ${expectedEnd.toString()}.`,
      };
    }

    cursor = range.ticketEnd + 1n;
  }

  if (cursor !== expectedTotal) {
    return {
      rangesCoverTotal: false,
      rangeError: `Final cursor ${cursor.toString()} does not match expected total ${expectedTotal.toString()}.`,
    };
  }

  return {
    rangesCoverTotal: true,
    rangeError: null,
  };
}

export function findRangeByWinningTicket(
  ranges: TicketRange[],
  winningTicket: bigint,
): TicketRange | null {
  return (
    ranges.find(
      (range) =>
        winningTicket >= range.ticketStart && winningTicket <= range.ticketEnd,
    ) ?? null
  );
}
