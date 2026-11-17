import { describe, expect, it } from "vitest";
import { createUploadSchema, UPLOAD_NOTE_MAX } from "./api";

const upload = { name: "IMG_0001.MOV", size: 2048, type: "video/quicktime" };

describe("a sender's note", () => {
  it("is optional", () => {
    expect(createUploadSchema.parse(upload).note).toBeUndefined();
  });

  it("is cleaned like a name: one line, nothing invisible", () => {
    const { note } = createUploadSchema.parse({
      ...upload,
      note: "  Round 2,\n\nfrom the‮ left ​side  ",
    });
    expect(note).toBe("Round 2, from the left side");
  });

  it("is empty when nothing visible is left, which stores no note", () => {
    expect(createUploadSchema.parse({ ...upload, note: " ​‮ " }).note).toBe("");
  });

  it("is refused when longer than the limit, once cleaned", () => {
    expect(
      createUploadSchema.safeParse({ ...upload, note: "a".repeat(UPLOAD_NOTE_MAX) }).success,
    ).toBe(true);
    expect(
      createUploadSchema.safeParse({ ...upload, note: "a".repeat(UPLOAD_NOTE_MAX + 1) }).success,
    ).toBe(false);
    // Spaces that collapse don't count against it.
    expect(
      createUploadSchema.safeParse({ ...upload, note: `${"a ".repeat(140)}${" ".repeat(400)}` })
        .success,
    ).toBe(true);
  });
});
