import { describe, expect, it } from "vitest";
import { getDisplayRoundPhaseLabel } from "./room-summary";

describe("room-summary", () => {
  it("keeps ENTRY OPEN for OPEN rounds while server catch-up starts the next round", () => {
    expect(
      getDisplayRoundPhaseLabel(
        {
          status: "OPEN",
          phase: "ENTRY_OPEN",
          phaseLabel: "ENTRY OPEN",
          msUntilLock: 0,
        },
        0,
      ),
    ).toBe("ENTRY OPEN");
  });

  it("keeps ENTRY OPEN for OPEN rounds with time remaining", () => {
    expect(
      getDisplayRoundPhaseLabel(
        {
          status: "OPEN",
          phase: "ENTRY_OPEN",
          phaseLabel: "ENTRY OPEN",
          msUntilLock: 1_000,
        },
        1_000,
      ),
    ).toBe("ENTRY OPEN");
  });
});
