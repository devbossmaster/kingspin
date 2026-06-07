import { createHmac } from "node:crypto";
import { findRangeByWinningTicket, type TicketRange } from "./ticket-ranges";

export const FAIRNESS_ALGORITHM = "HMAC_SHA256_REJECTION_SAMPLING_V1" as const;

const SHA256_SPACE = 1n << 256n;

export type DrawInputParts = {
  roundId: string;
  roundNumber: number;
  totalEntryAmount: bigint;
  entriesHash: string;
};

export type WinnerSelectionResult = {
  drawInput: string;
  drawHash: string;
  nonceUsed: number;
  winningTicket: bigint;
  winnerRange: TicketRange;
};

function assertDrawParts(parts: DrawInputParts) {
  if (!parts.roundId) {
    throw new Error("roundId is required.");
  }

  if (!Number.isSafeInteger(parts.roundNumber) || parts.roundNumber <= 0) {
    throw new Error("roundNumber must be a positive safe integer.");
  }

  if (parts.totalEntryAmount <= 0n) {
    throw new Error("totalEntryAmount must be greater than zero.");
  }

  if (parts.totalEntryAmount > SHA256_SPACE) {
    throw new Error(
      "totalEntryAmount must not exceed the SHA-256 value space.",
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(parts.entriesHash)) {
    throw new Error("entriesHash must be a SHA-256 hex digest.");
  }
}

export function buildDrawInput(parts: DrawInputParts, nonce: number): string {
  assertDrawParts(parts);

  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error("nonce must be a non-negative safe integer.");
  }

  return JSON.stringify({
    algorithm: FAIRNESS_ALGORITHM,
    roundId: parts.roundId,
    roundNumber: parts.roundNumber.toString(),
    totalEntryAmount: parts.totalEntryAmount.toString(),
    entriesHash: parts.entriesHash.toLowerCase(),
    nonce: nonce.toString(),
  });
}

export function selectWinningTicket(args: {
  serverSeed: string;
  drawParts: DrawInputParts;
}): {
  drawInput: string;
  drawHash: string;
  nonceUsed: number;
  winningTicket: bigint;
} {
  if (!args.serverSeed) {
    throw new Error("serverSeed is required.");
  }

  assertDrawParts(args.drawParts);

  const acceptanceLimit =
    SHA256_SPACE - (SHA256_SPACE % args.drawParts.totalEntryAmount);

  for (let nonce = 0; nonce < Number.MAX_SAFE_INTEGER; nonce += 1) {
    const drawInput = buildDrawInput(args.drawParts, nonce);
    const drawHash = createHmac("sha256", args.serverSeed)
      .update(drawInput)
      .digest("hex");
    const digestValue = BigInt(`0x${drawHash}`);

    if (digestValue >= acceptanceLimit) {
      continue;
    }

    return {
      drawInput,
      drawHash,
      nonceUsed: nonce,
      winningTicket: digestValue % args.drawParts.totalEntryAmount,
    };
  }

  throw new Error("Could not select a winning ticket within the nonce limit.");
}

export function selectWinner(args: {
  ranges: TicketRange[];
  serverSeed: string;
  roundId: string;
  roundNumber: number;
  totalEntryAmount: bigint;
  entriesHash: string;
}): WinnerSelectionResult {
  const selection = selectWinningTicket({
    serverSeed: args.serverSeed,
    drawParts: {
      roundId: args.roundId,
      roundNumber: args.roundNumber,
      totalEntryAmount: args.totalEntryAmount,
      entriesHash: args.entriesHash,
    },
  });

  const winnerRange = findRangeByWinningTicket(
    args.ranges,
    selection.winningTicket,
  );

  if (!winnerRange) {
    throw new Error(
      `Winning ticket ${selection.winningTicket.toString()} did not match any ticket range.`,
    );
  }

  return {
    ...selection,
    winnerRange,
  };
}
