import { describe, expect, it } from "vitest";
import {
  buildDrawInput,
  buildTicketRanges,
  calculateSpinAngle,
  selectWinner,
  verifyFairnessProof,
  verifyTicketRanges,
} from "../index";

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

  it("selects a deterministic winner from the draw input", () => {
    const ranges = buildTicketRanges([
      { id: "a", userId: "user-a", amount: 1500n },
      { id: "b", userId: "user-b", amount: 2000n },
    ]);

    const result = selectWinner({
      ranges,
      serverSeed:
        "375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d",
      roundId: "cmpmhquq2000gcfq01znqehcp",
      roundNumber: 2,
      totalEntryAmount: 3500n,
    });

    expect(result.winningTicket).toBe(1968n);
    expect(result.winnerRange.id).toBe("b");
  });

  it("verifies a completed round fairness proof", () => {
    const proof = verifyFairnessProof({
      serverSeedReveal:
        "375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d",
      serverSeedHash:
        "f9b0b3d8ae33d8b443f21916c18f5633b4a2aca2814cec3c14e67971250f367c",
      winningTicket: 1968n,
      drawParts: {
        roundId: "cmpmhquq2000gcfq01znqehcp",
        roundNumber: 2,
        totalEntryAmount: 3500n,
      },
    });

    expect(proof.seedHashMatches).toBe(true);
    expect(proof.winningTicketMatches).toBe(true);
    expect(proof.recomputedWinningTicket).toBe(1968n);
  });

  it("calculates spin angle from winning ticket", () => {
    expect(calculateSpinAngle(1968n, 3500n)).toBe(202.4228);
  });

  it("builds the same draw input format used by the API", () => {
    expect(
      buildDrawInput({
        serverSeed:
          "375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d",
        roundId: "cmpmhquq2000gcfq01znqehcp",
        roundNumber: 2,
        totalEntryAmount: 3500n,
      }),
    ).toBe(
      "375df2fced0138cb84f1f923827afb2b538c525d88b7183d529d62e3c82c855d:cmpmhquq2000gcfq01znqehcp:2:3500",
    );
  });
});
