import { describe, expect, it } from "vitest";
import { viewingAfter } from "./neighbour";

const ids = ["a", "b", "c", "d", "e"];

describe("the clip on show after some leave", () => {
  it("is the next one still there", () => {
    expect(viewingAfter(ids, "b", new Set(["b"]))).toBe("c");
    // A blocked sender's clips go together.
    expect(viewingAfter(ids, "b", new Set(["b", "c", "e"]))).toBe("d");
  });

  it("is the previous one at the end of the list", () => {
    expect(viewingAfter(ids, "e", new Set(["e"]))).toBe("d");
    expect(viewingAfter(ids, "d", new Set(["c", "d", "e"]))).toBe("b");
  });

  it("is none when all of them went", () => {
    expect(viewingAfter(ids, "a", new Set(ids))).toBeNull();
    expect(viewingAfter(ids, "z", new Set(["z"]))).toBeNull();
  });

  it("stays when it isn't among them", () => {
    expect(viewingAfter(ids, "a", new Set(["b"]))).toBe("a");
  });
});
