import { describe, expect, it } from "vitest";
import {
  buildRoomCode,
  formatCategoryLabel,
  formatGameModeLabel,
  getRoomDisplayName,
} from "./game-modes";

describe("game mode display helpers", () => {
  it("uses the player-facing Classic and Flex labels", () => {
    expect(formatGameModeLabel("FIXED_EQUAL_CHANCE")).toBe("Classic");
    expect(formatGameModeLabel("FLEXIBLE_PROPORTIONAL")).toBe("Flex");
  });

  it("maps legacy category slugs to the new category names", () => {
    expect(formatCategoryLabel("fixed-10")).toBe("Base");
    expect(formatCategoryLabel("pro-100-200")).toBe("Palace");
    expect(formatCategoryLabel("pro-200-350")).toBe("Empire");
  });

  it("builds stable room codes without exposing internal identifiers", () => {
    expect(buildRoomCode("fixed", "fixed-10", 0)).toBe("CB01");
    expect(buildRoomCode("fixed", "fixed-20", 1)).toBe("CP02");
    expect(buildRoomCode("pro", "pro-200-350", 2)).toBe("FE03");
    expect(
      getRoomDisplayName({
        code: "cm12345678901234567890",
        name: null,
        gameMode: "FLEXIBLE_PROPORTIONAL",
        categorySlug: "pro-10-100",
      }),
    ).toBe("FB01");
  });
});
