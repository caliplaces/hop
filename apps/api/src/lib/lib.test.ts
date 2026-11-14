import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { newId, randomString, signPayload, verifyPayload } from "./crypto";
import { safeReturnTo } from "./http";
import { sniffMedia } from "./sniff";
import { contentDisposition, normalizeEtag, presignUploadPart } from "./storage";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array([...out, ...new Array(64).fill(0)]);
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
  const app = "https://onmyhop.com";
  it("keeps same-origin paths", () => {
    expect(safeReturnTo("/app/hops", app)).toBe("/app/hops");
    expect(safeReturnTo("/matej/worlds?x=1#top", app)).toBe("/matej/worlds?x=1#top");
  });
  it("rejects anything that leaves the origin", () => {
    for (const input of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "",
      undefined,
    ]) {
      expect(safeReturnTo(input, app)).toBe("/app");
    }
  });
});

const MiB = 1024 * 1024;

describe("sniffMedia", () => {
  it("recognises what phones produce", () => {
    expect(sniffMedia(bytes([0, 0, 0, 0x20], "ftypisom"), 50 * MiB)).toBe("video/mp4");
    expect(sniffMedia(bytes([0, 0, 0, 0x14], "ftypqt  "), 50 * MiB)).toBe("video/quicktime");
    expect(sniffMedia(bytes([0, 0, 0, 0x18], "ftyp3gp4"), 50 * MiB)).toBe("video/3gpp");
    expect(sniffMedia(bytes([0, 0, 0, 0x18], "ftypheic"), MiB)).toBe("image/heic");
    expect(sniffMedia(bytes([0, 0, 0, 0x08], "wide", [0, 0, 0, 0x10], "mdat"), MiB)).toBe(
      "video/quicktime",
    );
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], "webm"), MiB)).toBe(
      "video/webm",
    );
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]), MiB)).toBe("image/jpeg");
    expect(sniffMedia(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]), MiB)).toBe("image/png");
    expect(sniffMedia(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), MiB)).toBe("image/webp");
  });
  it("rejects polyglots and other files", () => {
    // HTML/SVG with a magic word at offset 4
    expect(sniffMedia(bytes("<!--free--><svg onload=alert(1)>"), MiB)).toBeNull();
    expect(sniffMedia(bytes("<!--ftypisom--><script>"), MiB)).toBeNull();
    // Windows executable header followed by an atom name
    expect(sniffMedia(bytes("MZ", [0x90, 0], "free"), MiB)).toBeNull();
    expect(sniffMedia(bytes("MZ", [0x90, 0], "mdat"), MiB)).toBeNull();
    // ftyp box larger than the file itself
    expect(sniffMedia(bytes([0, 0, 0x10, 0], "ftypisom"), 1024)).toBeNull();
    expect(sniffMedia(bytes("GGGG text"), MiB)).toBeNull();
    expect(sniffMedia(bytes("%PDF-1.7"), MiB)).toBeNull();
    expect(sniffMedia(bytes("PK", [3, 4]), MiB)).toBeNull();
    expect(sniffMedia(bytes("RIFF", [0, 0, 0, 0], "AVI LIST"), MiB)).toBeNull();
    expect(sniffMedia(new Uint8Array([0xff, 0xd8]), MiB)).toBeNull();
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
  it("signs Content-Length into presigned part URLs", async () => {
    const env = {
      ENVIRONMENT: "production",
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "AKID",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "hop-production",
    } as Env;
    const url = new URL(await presignUploadPart(env, "hops/h/f/original", "up1", 3, 1234));
    expect(url.host).toBe("acc.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/hop-production/hops/h/f/original");
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });
  it("refuses the dev fallback outside development", async () => {
    const env = { ENVIRONMENT: "production", R2_BUCKET_NAME: "b", SESSION_SECRET: "s" } as Env;
    await expect(presignUploadPart(env, "k", "u", 1, 1)).rejects.toThrow();
  });
});
