import { describe, expect, it } from "vitest";
import { getDisplayRoundPhaseLabel } from "./room-summary";

describe("room-summary", () => {
  it("shows LOCKING... for OPEN rounds whose countdown reached zero", () => {
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
    ).toBe("LOCKING...");
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
