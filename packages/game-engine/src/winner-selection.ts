import { createHash } from "node:crypto";
import { findRangeByWinningTicket, type TicketRange } from "./ticket-ranges";

export type DrawInputParts = {
  serverSeed: string;
  roundId: string;
  roundNumber: number;
  totalEntryAmount: bigint;
};

export type WinnerSelectionResult = {
  drawInput: string;
  drawHash: string;
  winningTicket: bigint;
  winnerRange: TicketRange;
};

export function buildDrawInput(parts: DrawInputParts): string {
  if (!parts.serverSeed) {
    throw new Error("serverSeed is required.");
  }

  if (!parts.roundId) {
    throw new Error("roundId is required.");
  }

  if (!Number.isSafeInteger(parts.roundNumber) || parts.roundNumber <= 0) {
    throw new Error("roundNumber must be a positive safe integer.");
  }

  if (parts.totalEntryAmount <= 0n) {
    throw new Error("totalEntryAmount must be greater than zero.");
  }

  return [
    parts.serverSeed,
    parts.roundId,
    parts.roundNumber.toString(),
    parts.totalEntryAmount.toString(),
  ].join(":");
}

export function hashToHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function selectWinningTicket(args: {
  drawInput: string;
  totalEntryAmount: bigint;
}): {
  drawHash: string;
  winningTicket: bigint;
} {
  if (args.totalEntryAmount <= 0n) {
    throw new Error("totalEntryAmount must be greater than zero.");
  }

  const drawHash = hashToHex(args.drawInput);
  const winningTicket = BigInt(`0x${drawHash}`) % args.totalEntryAmount;

  return {
    drawHash,
    winningTicket,
  };
}

export function selectWinner(args: {
  ranges: TicketRange[];
  serverSeed: string;
  roundId: string;
  roundNumber: number;
  totalEntryAmount: bigint;
}): WinnerSelectionResult {
  const drawInput = buildDrawInput({
    serverSeed: args.serverSeed,
    roundId: args.roundId,
    roundNumber: args.roundNumber,
    totalEntryAmount: args.totalEntryAmount,
  });

  const { drawHash, winningTicket } = selectWinningTicket({
    drawInput,
    totalEntryAmount: args.totalEntryAmount,
  });

  const winnerRange = findRangeByWinningTicket(args.ranges, winningTicket);

  if (!winnerRange) {
    throw new Error(
      `Winning ticket ${winningTicket.toString()} did not match any ticket range.`,
    );
  }

  return {
    drawInput,
    drawHash,
    winningTicket,
    winnerRange,
  };
}
