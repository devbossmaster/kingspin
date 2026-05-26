import { createHash } from "node:crypto";
import {
  buildDrawInput,
  selectWinningTicket,
  type DrawInputParts,
} from "./winner-selection";

export type FairnessProofResult = {
  serverSeedHash: string | null;
  recomputedServerSeedHash: string | null;
  seedHashMatches: boolean;
  drawInput: string | null;
  drawHash: string | null;
  recomputedWinningTicket: bigint | null;
  winningTicketMatches: boolean;
};

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function verifyFairnessProof(args: {
  serverSeedReveal: string | null;
  serverSeedHash: string | null;
  winningTicket: bigint | null;
  drawParts: Omit<DrawInputParts, "serverSeed">;
}): FairnessProofResult {
  const recomputedServerSeedHash = args.serverSeedReveal
    ? sha256Hex(args.serverSeedReveal)
    : null;

  const seedHashMatches =
    !!args.serverSeedReveal &&
    !!args.serverSeedHash &&
    recomputedServerSeedHash === args.serverSeedHash;

  if (
    !args.serverSeedReveal ||
    !args.serverSeedHash ||
    args.drawParts.totalEntryAmount <= 0n
  ) {
    return {
      serverSeedHash: args.serverSeedHash,
      recomputedServerSeedHash,
      seedHashMatches,
      drawInput: null,
      drawHash: null,
      recomputedWinningTicket: null,
      winningTicketMatches: false,
    };
  }

  const drawInput = buildDrawInput({
    serverSeed: args.serverSeedReveal,
    ...args.drawParts,
  });

  const { drawHash, winningTicket: recomputedWinningTicket } =
    selectWinningTicket({
      drawInput,
      totalEntryAmount: args.drawParts.totalEntryAmount,
    });

  return {
    serverSeedHash: args.serverSeedHash,
    recomputedServerSeedHash,
    seedHashMatches,
    drawInput,
    drawHash,
    recomputedWinningTicket,
    winningTicketMatches:
      args.winningTicket !== null &&
      recomputedWinningTicket === args.winningTicket,
  };
}
