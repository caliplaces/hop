import { createUploadSchema, UPLOAD_NOTE_MAX } from "@hop/shared";
import { describe, expect, it } from "vitest";
import { fitNote, noteLength } from "./useUploadNote";

const upload = (note: string | undefined) =>
  createUploadSchema.safeParse({ name: "a.mp4", size: 1_000_000, type: "video/mp4", note });

describe("the note", () => {
  it("is counted as the server cleans it", () => {
    expect(noteLength("  Round   2  ")).toBe(7);
    // "½" becomes "1⁄2" once cleaned: three characters, not one.
    expect(noteLength("½".repeat(100))).toBe(300);
  });

  it("is sent cleaned, and nothing for a blank one", () => {
    expect(fitNote("  Round   2  ")).toBe("Round 2");
    expect(fitNote("   ")).toBeUndefined();
  });

  it("never stops an upload, however cleaning grows it", () => {
    for (const note of [
      "½".repeat(100),
      "é".repeat(280),
      `${"a".repeat(279)}😀😀`,
      "x".repeat(280),
    ]) {
      const sent = fitNote(note);
      expect(sent?.length).toBeLessThanOrEqual(UPLOAD_NOTE_MAX);
      expect(upload(sent).success).toBe(true);
    }
    // Whole characters only: no half of an emoji left at the end.
    expect(fitNote(`${"a".repeat(279)}😀`)).toBe("a".repeat(279));
  });
});
