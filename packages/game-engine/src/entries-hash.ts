import { createHash } from "node:crypto";

export const ENTRIES_HASH_FORMAT = "KINGSPIN_ENTRIES_V1" as const;

export type FairnessEntry = {
  entryId: string;
  userId: string;
  amount: bigint;
  ticketStart: bigint;
  ticketEnd: bigint;
  roundId: string;
};

function compareEntries(left: FairnessEntry, right: FairnessEntry) {
  if (left.ticketStart !== right.ticketStart) {
    return left.ticketStart < right.ticketStart ? -1 : 1;
  }

  if (left.ticketEnd !== right.ticketEnd) {
    return left.ticketEnd < right.ticketEnd ? -1 : 1;
  }

  if (left.entryId === right.entryId) {
    return 0;
  }

  return left.entryId < right.entryId ? -1 : 1;
}

function assertEntry(entry: FairnessEntry) {
  if (!entry.entryId || !entry.userId || !entry.roundId) {
    throw new Error("Fairness entries require entryId, userId, and roundId.");
  }

  if (entry.amount <= 0n) {
    throw new Error("Fairness entry amount must be greater than zero.");
  }

  if (entry.ticketStart < 0n || entry.ticketEnd < entry.ticketStart) {
    throw new Error("Fairness entry ticket range is invalid.");
  }
}

export function canonicalizeEntries(entries: FairnessEntry[]): string {
  const sortedEntries = entries
    .map((entry) => {
      assertEntry(entry);
      return entry;
    })
    .sort(compareEntries);

  return JSON.stringify({
    format: ENTRIES_HASH_FORMAT,
    entries: sortedEntries.map((entry) => ({
      entryId: entry.entryId,
      userId: entry.userId,
      amount: entry.amount.toString(),
      ticketStart: entry.ticketStart.toString(),
      ticketEnd: entry.ticketEnd.toString(),
      roundId: entry.roundId,
    })),
  });
}

export function calculateEntriesHash(entries: FairnessEntry[]): string {
  return createHash("sha256")
    .update(canonicalizeEntries(entries))
    .digest("hex");
}
