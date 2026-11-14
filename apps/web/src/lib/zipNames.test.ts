import { describe, expect, it } from "vitest";
import { zipEntryNames } from "./zipNames";

describe("zipEntryNames", () => {
  it("groups by contributor and de-duplicates", () => {
    expect(
      zipEntryNames([
        { name: "a.mp4", contributorName: "@matej" },
        { name: "a.mp4", contributorName: "@matej" },
        { name: "A.MP4", contributorName: "@matej" },
        { name: "b", contributorName: null },
      ]),
    ).toEqual(["@matej/a.mp4", "@matej/a (1).mp4", "@matej/A (2).MP4", "Unknown/b"]);
  });

  it("never reuses a generated name", () => {
    const names = zipEntryNames([
      { name: "clip.mp4", contributorName: "a" },
      { name: "clip.mp4", contributorName: "a" },
      { name: "clip (1).mp4", contributorName: "a" },
    ]);
    expect(names).toEqual(["a/clip.mp4", "a/clip (1).mp4", "a/clip (1) (1).mp4"]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  it("can't escape the archive", () => {
    const names = zipEntryNames([
      { name: "x.mp4", contributorName: ".." },
      { name: "../../etc/passwd", contributorName: "a/b" },
      { name: "..", contributorName: "." },
      { name: "evil\u0000.mp4", contributorName: "C:\\Users" },
    ]);
    expect(names).toEqual([
      "Unknown/x.mp4",
      "a_b/.._.._etc_passwd",
      "Unknown/file",
      "C__Users/evil_.mp4",
    ]);
    for (const name of names) {
      expect(name.split("/").every((segment) => segment !== ".." && segment !== ".")).toBe(true);
    }
  });
});
