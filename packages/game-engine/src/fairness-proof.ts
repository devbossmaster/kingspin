import { createHash } from "node:crypto";
import { calculateEntriesHash, type FairnessEntry } from "./entries-hash";
import {
  FAIRNESS_ALGORITHM,
  selectWinningTicket,
  type DrawInputParts,
} from "./winner-selection";
import { findRangeByWinningTicket, verifyTicketRanges } from "./ticket-ranges";

export type FairnessProofResult = {
  algorithm: string | null;
  algorithmMatches: boolean;
  serverSeedHash: string | null;
  serverSeedReveal: string | null;
  recomputedServerSeedHash: string | null;
  seedHashMatches: boolean;
  entriesHash: string | null;
  recomputedEntriesHash: string | null;
  entriesHashMatches: boolean;
  totalEntryAmount: bigint;
  winningTicket: bigint | null;
  drawInput: string | null;
  drawHash: string | null;
  recomputedDrawHash: string | null;
  drawHashMatches: boolean;
  nonceUsed: number | null;
  recomputedWinningTicket: bigint | null;
  winningTicketMatches: boolean;
  winnerTicketInsideRange: boolean;
  rangesCoverTotal: boolean;
  rangeError: string | null;
  verificationPassed: boolean;
};

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function verifyFairnessProof(args: {
  algorithm: string | null;
  serverSeedReveal: string | null;
  serverSeedHash: string | null;
  entriesHash: string | null;
  entries: FairnessEntry[];
  winningTicket: bigint | null;
  drawHash: string | null;
  nonceUsed: number | null;
  winnerEntryId: string | null;
  drawParts: Omit<DrawInputParts, "entriesHash">;
}): FairnessProofResult {
  const algorithmMatches = args.algorithm === FAIRNESS_ALGORITHM;
  const recomputedServerSeedHash = args.serverSeedReveal
    ? sha256Hex(args.serverSeedReveal)
    : null;

  const seedHashMatches =
    !!args.serverSeedReveal &&
    !!args.serverSeedHash &&
    recomputedServerSeedHash === args.serverSeedHash;

  let recomputedEntriesHash: string | null = null;
  let rangesCoverTotal = false;
  let rangeError: string | null = null;

  try {
    recomputedEntriesHash = calculateEntriesHash(args.entries);
    const rangesCheck = verifyTicketRanges(
      args.entries.map((entry) => ({
        id: entry.entryId,
        userId: entry.userId,
        amount: entry.amount,
        ticketStart: entry.ticketStart,
        ticketEnd: entry.ticketEnd,
      })),
      args.drawParts.totalEntryAmount,
    );
    rangesCoverTotal = rangesCheck.rangesCoverTotal;
    rangeError = rangesCheck.rangeError;
  } catch (error) {
    rangeError = error instanceof Error ? error.message : String(error);
  }

  const entriesHashMatches =
    !!args.entriesHash &&
    recomputedEntriesHash === args.entriesHash.toLowerCase();

  if (
    !algorithmMatches ||
    !args.serverSeedReveal ||
    !args.serverSeedHash ||
    !args.entriesHash ||
    !entriesHashMatches ||
    args.drawParts.totalEntryAmount <= 0n
  ) {
    return {
      algorithm: args.algorithm,
      algorithmMatches,
      serverSeedHash: args.serverSeedHash,
      serverSeedReveal: args.serverSeedReveal,
      recomputedServerSeedHash,
      seedHashMatches,
      entriesHash: args.entriesHash,
      recomputedEntriesHash,
      entriesHashMatches,
      totalEntryAmount: args.drawParts.totalEntryAmount,
      winningTicket: args.winningTicket,
      drawInput: null,
      drawHash: args.drawHash,
      recomputedDrawHash: null,
      drawHashMatches: false,
      nonceUsed: args.nonceUsed,
      recomputedWinningTicket: null,
      winningTicketMatches: false,
      winnerTicketInsideRange: false,
      rangesCoverTotal,
      rangeError,
      verificationPassed: false,
    };
  }

  const selection = selectWinningTicket({
    serverSeed: args.serverSeedReveal,
    drawParts: {
      ...args.drawParts,
      entriesHash: args.entriesHash,
    },
  });
  const winnerRange = findRangeByWinningTicket(
    args.entries.map((entry) => ({
      id: entry.entryId,
      userId: entry.userId,
      amount: entry.amount,
      ticketStart: entry.ticketStart,
      ticketEnd: entry.ticketEnd,
    })),
    args.winningTicket ?? -1n,
  );
  const drawHashMatches =
    !!args.drawHash &&
    args.drawHash === selection.drawHash &&
    args.nonceUsed === selection.nonceUsed;
  const winningTicketMatches =
    args.winningTicket !== null &&
    selection.winningTicket === args.winningTicket;
  const winnerTicketInsideRange =
    !!winnerRange &&
    !!args.winnerEntryId &&
    winnerRange.id === args.winnerEntryId;

  return {
    algorithm: args.algorithm,
    algorithmMatches,
    serverSeedHash: args.serverSeedHash,
    serverSeedReveal: args.serverSeedReveal,
    recomputedServerSeedHash,
    seedHashMatches,
    entriesHash: args.entriesHash,
    recomputedEntriesHash,
    entriesHashMatches,
    totalEntryAmount: args.drawParts.totalEntryAmount,
    winningTicket: args.winningTicket,
    drawInput: selection.drawInput,
    drawHash: args.drawHash,
    recomputedDrawHash: selection.drawHash,
    drawHashMatches,
    nonceUsed: args.nonceUsed,
    recomputedWinningTicket: selection.winningTicket,
    winningTicketMatches,
    winnerTicketInsideRange,
    rangesCoverTotal,
    rangeError,
    verificationPassed:
      algorithmMatches &&
      seedHashMatches &&
      entriesHashMatches &&
      drawHashMatches &&
      winningTicketMatches &&
      winnerTicketInsideRange &&
      rangesCoverTotal,
  };
}
