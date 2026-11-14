import { describe, expect, it } from "vitest";
import { newId, randomString, signPayload, verifyPayload } from "./crypto";
import { safeReturnTo } from "./http";
import { sniffMedia } from "./sniff";
import { contentDisposition, normalizeEtag } from "./storage";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array([...out, ...new Array(512).fill(0)]);
};

describe("signed payloads", () => {
  type T = { purpose: "test"; exp: number; value: string };
  const secret = "s3cret";

  it("round-trips", async () => {
    const token = await signPayload<T>(secret, {
      purpose: "test",
      exp: Date.now() + 1000,
      value: "x",
    });
    expect((await verifyPayload<T>(secret, token, "test"))?.value).toBe("x");
  });

  it("rejects tampering, wrong secret, wrong purpose and expiry", async () => {
    const token = await signPayload<T>(secret, {
      purpose: "test",
      exp: Date.now() + 1000,
      value: "x",
    });
    const [body, sig] = token.split(".");
    const forged = `${btoa(JSON.stringify({ purpose: "test", exp: Date.now() + 1000, value: "y" }))}.${sig}`;
    expect(await verifyPayload<T>(secret, forged, "test")).toBeNull();
    expect(await verifyPayload<T>("other", token, "test")).toBeNull();
    expect(await verifyPayload(secret, token, "other" as never)).toBeNull();
    expect(await verifyPayload<T>(secret, `${body}`, "test")).toBeNull();
    const expired = await signPayload<T>(secret, {
      purpose: "test",
      exp: Date.now() - 1,
      value: "x",
    });
    expect(await verifyPayload<T>(secret, expired, "test")).toBeNull();
  });
});

describe("ids", () => {
  it("are prefixed and base36", () => {
    expect(newId("fil")).toMatch(/^fil_[0-9a-z]{20}$/);
    expect(randomString(50)).toHaveLength(50);
  });
});

describe("safeReturnTo", () => {
  it("only allows same-site paths", () => {
    expect(safeReturnTo("/app/hops")).toBe("/app/hops");
    expect(safeReturnTo("//evil.com")).toBe("/app");
    expect(safeReturnTo("/\\evil.com")).toBe("/app");
    expect(safeReturnTo("https://evil.com")).toBe("/app");
    expect(safeReturnTo(undefined)).toBe("/app");
  });
});

describe("sniffMedia", () => {
  it("recognises containers", () => {
    expect(sniffMedia(bytes([0, 0, 0, 0x20], "ftypisom"))).toBe("video");
    expect(sniffMedia(bytes([0, 0, 0, 0x14], "ftypqt  "))).toBe("video");
    expect(sniffMedia(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("image");
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe("video");
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image");
    expect(sniffMedia(bytes([0x89], "PNG"))).toBe("image");
    expect(sniffMedia(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("image");
  });
  it("rejects other files", () => {
    expect(sniffMedia(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffMedia(bytes("PK", [3, 4]))).toBeNull();
    expect(sniffMedia(bytes("<html>"))).toBeNull();
  });
});

describe("storage helpers", () => {
  it("normalizes ETags", () => {
    expect(normalizeEtag('"abc123"')).toBe("abc123");
    expect(normalizeEtag('W/"abc"')).toBe("abc");
    expect(normalizeEtag("abc")).toBe("abc");
  });
  it("encodes non-ASCII filenames safely", () => {
    expect(contentDisposition('Čo "to".mp4', true)).toBe(
      `attachment; filename="_o _to_.mp4"; filename*=UTF-8''%C4%8Co%20%22to%22.mp4`,
    );
  });
});
