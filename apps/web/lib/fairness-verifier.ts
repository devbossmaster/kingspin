import type { LatestRoundResult } from "@kingspin/contracts";

const FAIRNESS_ALGORITHM = "HMAC_SHA256_REJECTION_SAMPLING_V1";
const ENTRIES_HASH_FORMAT = "KINGSPIN_ENTRIES_V1";
const SHA256_SPACE = 1n << 256n;

type BrowserFairnessCheck = {
  seedHashMatches: boolean;
  entriesHashMatches: boolean;
  drawHashMatches: boolean;
  winningTicketMatches: boolean;
  winnerTicketInsideRange: boolean;
  rangesCoverTotal: boolean;
  verified: boolean;
};

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Hex(value: string) {
  return bytesToHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function hmacSha256Hex(keyValue: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
}

function canonicalEntries(result: LatestRoundResult) {
  return [...result.entries]
    .sort((left, right) => {
      const startComparison =
        BigInt(left.ticketStart ?? -1) - BigInt(right.ticketStart ?? -1);

      if (startComparison !== 0n) {
        return startComparison < 0n ? -1 : 1;
      }

      const endComparison =
        BigInt(left.ticketEnd ?? -1) - BigInt(right.ticketEnd ?? -1);

      if (endComparison !== 0n) {
        return endComparison < 0n ? -1 : 1;
      }

      if (left.id === right.id) {
        return 0;
      }

      return left.id < right.id ? -1 : 1;
    })
    .map((entry) => ({
      entryId: entry.id,
      userId: entry.userId,
      amount: entry.amount,
      ticketStart: entry.ticketStart,
      ticketEnd: entry.ticketEnd,
      roundId: entry.roundId,
    }));
}

function buildDrawInput(
  result: LatestRoundResult,
  entriesHash: string,
  nonce: number,
) {
  return JSON.stringify({
    algorithm: FAIRNESS_ALGORITHM,
    roundId: result.round.id,
    roundNumber: result.round.roundNumber.toString(),
    totalEntryAmount: result.round.totalEntryAmount,
    entriesHash: entriesHash.toLowerCase(),
    nonce: nonce.toString(),
  });
}

function verifyRanges(result: LatestRoundResult) {
  const entries = canonicalEntries(result);
  const total = BigInt(result.round.totalEntryAmount);
  let expectedStart = 0n;

  for (const entry of entries) {
    if (entry.ticketStart === null || entry.ticketEnd === null) {
      return false;
    }

    const start = BigInt(entry.ticketStart);
    const end = BigInt(entry.ticketEnd);

    if (
      start !== expectedStart ||
      end < start ||
      end - start + 1n !== BigInt(entry.amount)
    ) {
      return false;
    }

    expectedStart = end + 1n;
  }

  return expectedStart === total;
}

export async function verifyCompletedFairness(
  result: LatestRoundResult,
): Promise<BrowserFairnessCheck> {
  const proof = result.fairness;
  const serverSeed = result.serverSeedReveal;
  const entries = canonicalEntries(result);

  if (
    !serverSeed ||
    proof.algorithm !== FAIRNESS_ALGORITHM ||
    !proof.serverSeedHash ||
    !proof.entriesHash ||
    BigInt(result.round.totalEntryAmount) <= 0n ||
    BigInt(result.round.totalEntryAmount) > SHA256_SPACE
  ) {
    return {
      seedHashMatches: false,
      entriesHashMatches: false,
      drawHashMatches: false,
      winningTicketMatches: false,
      winnerTicketInsideRange: false,
      rangesCoverTotal: false,
      verified: false,
    };
  }

  const seedHashMatches =
    (await sha256Hex(serverSeed)) === proof.serverSeedHash.toLowerCase();
  const entriesHash = await sha256Hex(
    JSON.stringify({
      format: ENTRIES_HASH_FORMAT,
      entries,
    }),
  );
  const entriesHashMatches = entriesHash === proof.entriesHash.toLowerCase();
  const total = BigInt(result.round.totalEntryAmount);
  const acceptanceLimit = SHA256_SPACE - (SHA256_SPACE % total);
  let nonce = 0;
  let drawHash = "";
  let winningTicket = -1n;

  for (; nonce < Number.MAX_SAFE_INTEGER; nonce += 1) {
    drawHash = await hmacSha256Hex(
      serverSeed,
      buildDrawInput(result, entriesHash, nonce),
    );
    const digestValue = BigInt(`0x${drawHash}`);

    if (digestValue < acceptanceLimit) {
      winningTicket = digestValue % total;
      break;
    }
  }

  const drawHashMatches =
    drawHash === proof.drawHash && nonce === proof.nonceUsed;
  const winningTicketMatches = winningTicket.toString() === proof.winningTicket;
  const winner = result.entries.find(
    (entry) => entry.id === result.round.winnerEntryId,
  );
  const winnerTicketInsideRange =
    !!winner &&
    winner.ticketStart !== null &&
    winner.ticketEnd !== null &&
    winningTicket >= BigInt(winner.ticketStart) &&
    winningTicket <= BigInt(winner.ticketEnd);
  const rangesCoverTotal = verifyRanges(result);
  const verified =
    seedHashMatches &&
    entriesHashMatches &&
    drawHashMatches &&
    winningTicketMatches &&
    winnerTicketInsideRange &&
    rangesCoverTotal;

  return {
    seedHashMatches,
    entriesHashMatches,
    drawHashMatches,
    winningTicketMatches,
    winnerTicketInsideRange,
    rangesCoverTotal,
    verified,
  };
}
