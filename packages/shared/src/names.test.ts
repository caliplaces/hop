import { describe, expect, it } from "vitest";
import { contributorNameSchema } from "./api";
import { checkHandle, normalizeHandle, slugify } from "./handles";
import {
  isAcceptableDeclaredType,
  PART_BYTES,
  partCount,
  partLength,
  withMediaExtension,
} from "./limits";
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
    expect(slugify("  --Street   Kings!!--  ")).toBe("street-kings");
    expect(slugify("¿¡")).toBe("");
  });
  it("keeps slugs within 40 characters, never ending in a dash", () => {
    const slug = slugify(`${"a".repeat(39)} b`);
    expect(slug).toBe("a".repeat(39));
    expect(slugify("word ".repeat(20)).length).toBeLessThanOrEqual(40);
    expect(slugify("word ".repeat(20))).toMatch(/^[a-z0-9-]*[a-z0-9]$/);
  });
  it("handles long runs of separators", () => {
    expect(slugify(`${"-".repeat(100_000)}a`)).toBe("a");
    expect(slugify(`a${"-".repeat(100_000)}`)).toBe("a");
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

describe("media helpers", () => {
  it("checks declared types loosely but never allows SVG", () => {
    expect(isAcceptableDeclaredType("video/quicktime")).toBe(true);
    expect(isAcceptableDeclaredType("")).toBe(true);
    expect(isAcceptableDeclaredType("image/svg+xml")).toBe(false);
    expect(isAcceptableDeclaredType("text/html")).toBe(false);
  });
  it("fixes extensions to match the real type", () => {
    expect(withMediaExtension("clip.MOV", "video/quicktime")).toBe("clip.MOV");
    expect(withMediaExtension("photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
    expect(withMediaExtension("evil.html", "video/mp4")).toBe("evil.mp4");
    expect(withMediaExtension("noext", "image/png")).toBe("noext.png");
    expect(withMediaExtension(".hidden", "video/mp4")).toBe(".hidden.mp4");
  });
  it("computes part lengths", () => {
    expect(partLength(PART_BYTES * 2 + 5, 1)).toBe(PART_BYTES);
    expect(partLength(PART_BYTES * 2 + 5, 3)).toBe(5);
  });
});

describe("contributorNameSchema", () => {
  it("strips the verified-handle prefix and control characters", () => {
    expect(contributorNameSchema.parse("  @@matej ")).toBe("matej");
    expect(contributorNameSchema.parse("Coach\u0000 Peter")).toBe("Coach Peter");
    expect(contributorNameSchema.safeParse("@").success).toBe(false);
  });
});
