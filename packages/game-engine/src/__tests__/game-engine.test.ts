import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildDrawInput,
  calculateEntriesHash,
  findRangeByWinningTicket,
  buildTicketRanges,
  calculateSpinAngle,
  FAIRNESS_ALGORITHM,
  selectWinner,
  selectWinningTicket,
  sha256Hex,
  verifyFairnessProof,
  verifyTicketRanges,
} from "../index";

const serverSeed =
  "375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d";
const roundId = "cmpmhquq2000gcfq01znqehcp";
const fairnessEntries = [
  {
    entryId: "a",
    userId: "user-a",
    amount: 1500n,
    ticketStart: 0n,
    ticketEnd: 1499n,
    roundId,
  },
  {
    entryId: "b",
    userId: "user-b",
    amount: 2000n,
    ticketStart: 1500n,
    ticketEnd: 3499n,
    roundId,
  },
];
const entriesHash =
  "425d3f746b8c9858ea14a98433ecffbe7eaae92305781c636a80be6e96097850";
const drawHash =
  "7f7cd80fcc95aef291cb43f849ace4dfb4a1cd15ff2e84f41d6fd041ec6cbc20";

describe("game-engine", () => {
  it("builds proportional ticket ranges in order", () => {
    const ranges = buildTicketRanges([
      { id: "a", userId: "user-a", amount: 1500n },
      { id: "b", userId: "user-b", amount: 2000n },
    ]);

    expect(ranges[0].ticketStart).toBe(0n);
    expect(ranges[0].ticketEnd).toBe(1499n);
    expect(ranges[1].ticketStart).toBe(1500n);
    expect(ranges[1].ticketEnd).toBe(3499n);

    expect(verifyTicketRanges(ranges, 3500n)).toEqual({
      rangesCoverTotal: true,
      rangeError: null,
    });
  });

  it("covers the full ticket interval without gaps or overlaps", () => {
    const ranges = buildTicketRanges([
      { id: "a", userId: "user-a", amount: 1n },
      { id: "b", userId: "user-b", amount: 3n },
      { id: "c", userId: "user-c", amount: 2n },
    ]);

    expect(ranges).toEqual([
      {
        id: "a",
        userId: "user-a",
        amount: 1n,
        ticketStart: 0n,
        ticketEnd: 0n,
      },
      {
        id: "b",
        userId: "user-b",
        amount: 3n,
        ticketStart: 1n,
        ticketEnd: 3n,
      },
      {
        id: "c",
        userId: "user-c",
        amount: 2n,
        ticketStart: 4n,
        ticketEnd: 5n,
      },
    ]);
    expect(findRangeByWinningTicket(ranges, 0n)?.id).toBe("a");
    expect(findRangeByWinningTicket(ranges, 3n)?.id).toBe("b");
    expect(findRangeByWinningTicket(ranges, 5n)?.id).toBe("c");
    expect(findRangeByWinningTicket(ranges, 6n)).toBeNull();
  });

  it("hashes the revealed server seed to its original commitment", () => {
    expect(sha256Hex(serverSeed)).toBe(
      "f9b0b3d8ae33d8b443f21916c18f5633b4a2aca2814cec3c14e67971250f367c",
    );
  });

  it("builds a stable canonical entries hash", () => {
    expect(calculateEntriesHash(fairnessEntries)).toBe(entriesHash);
    expect(calculateEntriesHash([...fairnessEntries].reverse())).toBe(
      entriesHash,
    );
  });

  it("changes the entries hash when a ticket range changes", () => {
    expect(
      calculateEntriesHash([
        fairnessEntries[0],
        {
          ...fairnessEntries[1],
          ticketStart: 1501n,
        },
      ]),
    ).not.toBe(entriesHash);
  });

  it("selects a deterministic winner from the committed draw input", () => {
    const ranges = buildTicketRanges([
      { id: "a", userId: "user-a", amount: 1500n },
      { id: "b", userId: "user-b", amount: 2000n },
    ]);

    const result = selectWinner({
      ranges,
      serverSeed,
      roundId,
      roundNumber: 2,
      totalEntryAmount: 3500n,
      entriesHash,
    });

    expect(result.drawHash).toBe(drawHash);
    expect(result.nonceUsed).toBe(0);
    expect(result.winningTicket).toBe(2696n);
    expect(result.winnerRange.id).toBe("b");
  });

  it("changes the ticket when the seed or entries commitment changes", () => {
    const drawParts = {
      roundId,
      roundNumber: 2,
      totalEntryAmount: 3500n,
      entriesHash,
    };
    const original = selectWinningTicket({ serverSeed, drawParts });
    const changedSeed = selectWinningTicket({
      serverSeed: `${serverSeed}-changed`,
      drawParts,
    });
    const changedEntries = selectWinningTicket({
      serverSeed,
      drawParts: {
        ...drawParts,
        entriesHash: "a".repeat(64),
      },
    });

    expect(changedSeed.winningTicket).not.toBe(original.winningTicket);
    expect(changedEntries.winningTicket).not.toBe(original.winningTicket);
  });

  it("uses rejection sampling with large BigInt totals", () => {
    const totalEntryAmount = (1n << 255n) + 1n;
    const result = selectWinningTicket({
      serverSeed: "seed-0",
      drawParts: {
        roundId: "round-rejection",
        roundNumber: 1,
        totalEntryAmount,
        entriesHash: "a".repeat(64),
      },
    });

    expect(result.nonceUsed).toBe(1);
    expect(result.winningTicket).toBeGreaterThanOrEqual(0n);
    expect(result.winningTicket).toBeLessThan(totalEntryAmount);
  });

  it("verifies a completed round fairness proof", () => {
    const proof = verifyFairnessProof({
      algorithm: FAIRNESS_ALGORITHM,
      serverSeedReveal: serverSeed,
      serverSeedHash:
        "f9b0b3d8ae33d8b443f21916c18f5633b4a2aca2814cec3c14e67971250f367c",
      entriesHash,
      entries: fairnessEntries,
      winningTicket: 2696n,
      drawHash,
      nonceUsed: 0,
      winnerEntryId: "b",
      drawParts: {
        roundId,
        roundNumber: 2,
        totalEntryAmount: 3500n,
      },
    });

    expect(proof.seedHashMatches).toBe(true);
    expect(proof.entriesHashMatches).toBe(true);
    expect(proof.drawHashMatches).toBe(true);
    expect(proof.winningTicketMatches).toBe(true);
    expect(proof.winnerTicketInsideRange).toBe(true);
    expect(proof.rangesCoverTotal).toBe(true);
    expect(proof.verificationPassed).toBe(true);
    expect(proof.recomputedWinningTicket).toBe(2696n);
  });

  it("fails verification when committed entries are tampered", () => {
    const proof = verifyFairnessProof({
      algorithm: FAIRNESS_ALGORITHM,
      serverSeedReveal: serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      entriesHash,
      entries: [
        fairnessEntries[0],
        { ...fairnessEntries[1], ticketStart: 1501n },
      ],
      winningTicket: 2696n,
      drawHash,
      nonceUsed: 0,
      winnerEntryId: "b",
      drawParts: {
        roundId,
        roundNumber: 2,
        totalEntryAmount: 3500n,
      },
    });

    expect(proof.entriesHashMatches).toBe(false);
    expect(proof.verificationPassed).toBe(false);
  });

  it("calculates spin angle from winning ticket", () => {
    expect(calculateSpinAngle(1968n, 3500n)).toBe(202.4228);
  });

  it("guards spin angle boundaries", () => {
    expect(calculateSpinAngle(0n, 3500n)).toBe(0);
    expect(() => calculateSpinAngle(3500n, 3500n)).toThrow(
      "winningTicket must be within total ticket range.",
    );
  });

  it("builds the same versioned draw input format used by the API", () => {
    expect(
      buildDrawInput(
        {
          roundId,
          roundNumber: 2,
          totalEntryAmount: 3500n,
          entriesHash,
        },
        0,
      ),
    ).toBe(
      `{"algorithm":"${FAIRNESS_ALGORITHM}","roundId":"${roundId}","roundNumber":"2","totalEntryAmount":"3500","entriesHash":"${entriesHash}","nonce":"0"}`,
    );
  });

  it("does not use Math.random in the winner-selection path", () => {
    const source = readFileSync(
      new URL("../winner-selection.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("Math.random");
  });
});
