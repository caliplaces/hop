import { describe, expect, it } from "vitest";
import { COLOR_IDS, colorFor, contrast, isColorId, PALETTE, textOn } from "./colors";

describe("palette", () => {
  it("has unique ids", () => {
    expect(new Set(COLOR_IDS).size).toBe(PALETTE.length);
  });

  it("gives every colour readable (WCAG AA) button text", () => {
    for (const color of PALETTE) {
      expect(contrast(color.hex, textOn(color.hex)), color.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("validates ids", () => {
    expect(isColorId("coral")).toBe(true);
    expect(isColorId("lime")).toBe(false);
    expect(isColorId(42)).toBe(false);
  });

  it("falls back to a stable colour per seed", () => {
    expect(colorFor("sky", "usr_1").id).toBe("sky");
    expect(colorFor(null, "usr_1")).toEqual(colorFor(undefined, "usr_1"));
    expect(colorFor("nope", "usr_1")).toEqual(colorFor(null, "usr_1"));
  });
});
