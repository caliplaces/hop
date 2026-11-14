import { describe, expect, it } from "vitest";
import { checkHandle, normalizeHandle, slugify } from "./handles";
import { PART_BYTES, partCount } from "./limits";
import { randomContributorName } from "./names";

describe("randomContributorName", () => {
  it("looks like AdjectiveAnimal123", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomContributorName()).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
    }
  });
});

describe("handles", () => {
  it("normalizes", () => {
    expect(normalizeHandle("  @Matej ")).toBe("matej");
  });
  it("validates", () => {
    expect(checkHandle("matej")).toBeNull();
    expect(checkHandle("matej.calisthenics")).toBeNull();
    expect(checkHandle("ab")).toBeNull();
    expect(checkHandle("a")).toBe("invalid");
    expect(checkHandle("-matej")).toBe("invalid");
    expect(checkHandle("ma..tej")).toBe("invalid");
    expect(checkHandle("api")).toBe("reserved");
  });
  it("slugifies", () => {
    expect(slugify("Worlds 2026 — Bratislava!")).toBe("worlds-2026-bratislava");
    expect(slugify("Čierny Balog")).toBe("cierny-balog");
  });
});

describe("partCount", () => {
  it("rounds up", () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(PART_BYTES)).toBe(1);
    expect(partCount(PART_BYTES + 1)).toBe(2);
    expect(partCount(5 * 1024 ** 3)).toBe(512);
  });
});
