import { describe, expect, it } from "vitest";
import { BASELINE_JPEG, CMYK_JPEG, PROGRESSIVE_JPEG, WIDE_JPEG } from "../test/jpegs";
import { sanitizeJpeg } from "./jpeg";

const text = (value: string) => new TextEncoder().encode(value);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `jpeg` with a segment added right after its start marker. */
function withSegment(jpeg: Uint8Array, marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat(
    jpeg.subarray(0, 2),
    new Uint8Array([0xff, marker, length >> 8, length & 0xff]),
    payload,
    jpeg.subarray(2),
  );
}

const contains = (haystack: Uint8Array, needle: Uint8Array) =>
  Buffer.from(haystack).includes(Buffer.from(needle));

describe("sanitizing a profile photo", () => {
  it("keeps a clean photo exactly as it is, baseline or progressive", () => {
    expect(sanitizeJpeg(BASELINE_JPEG)).toEqual(BASELINE_JPEG);
    expect(sanitizeJpeg(PROGRESSIVE_JPEG)).toEqual(PROGRESSIVE_JPEG);
  });

  it("drops EXIF (with its GPS location), comments and anything after the end", () => {
    const exif = concat(text("Exif\0\0"), text("GPSLatitude 50.0755 GPSLongitude 14.4378"));
    const dirty = concat(
      withSegment(withSegment(BASELINE_JPEG, 0xe1, exif), 0xfe, text("<script>alert(1)</script>")),
      text("<html><body>hosted here</body></html>PK\x03\x04"),
    );
    const clean = sanitizeJpeg(dirty);
    expect(clean).toEqual(BASELINE_JPEG);
    expect(contains(clean ?? new Uint8Array(), text("GPS"))).toBe(false);
  });

  it("keeps the colour profile", () => {
    const icc = concat(text("ICC_PROFILE\0"), new Uint8Array([1, 1, 0, 0, 2, 0]));
    const withProfile = withSegment(BASELINE_JPEG, 0xe2, icc);
    expect(sanitizeJpeg(withProfile)).toEqual(withProfile);
  });

  it("refuses what isn't a small, ordinary photo", () => {
    // Too large on a side: small files can decode to hundreds of megabytes.
    expect(sanitizeJpeg(WIDE_JPEG)).toBeNull();
    // Four components.
    expect(sanitizeJpeg(CMYK_JPEG)).toBeNull();
    // A JPEG's first bytes, then a web page.
    expect(sanitizeJpeg(concat(new Uint8Array([0xff, 0xd8, 0xff]), text("<html>")))).toBeNull();
    // Cut short before its end.
    expect(sanitizeJpeg(BASELINE_JPEG.subarray(0, BASELINE_JPEG.length - 10))).toBeNull();
    // Lossless coding instead of a baseline frame.
    const lossless = BASELINE_JPEG.slice();
    const frame = Buffer.from(lossless).indexOf(Buffer.from([0xff, 0xc0]));
    lossless[frame + 1] = 0xc3;
    expect(sanitizeJpeg(lossless)).toBeNull();
    expect(sanitizeJpeg(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});
