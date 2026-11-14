import type { MediaType } from "@hop/shared";

/** How many leading bytes sniffMedia needs. */
export const SNIFF_BYTES = 64;

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) >>> 0) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function isoBrand(brand: string): MediaType {
  if (/^(heic|heix|heim|heis|hevc|hevx)$/.test(brand)) return "image/heic";
  if (/^(mif1|msf1)$/.test(brand)) return "image/heif";
  if (/^avi[fs]$/.test(brand)) return "image/avif";
  if (brand.startsWith("3g")) return "video/3gpp";
  if (brand === "qt  ") return "video/quicktime";
  return "video/mp4";
}

/**
 * Work out a file's real media type from its first bytes. Only formats phones
 * and cameras actually produce are recognised, and container headers must be
 * structurally plausible (box sizes included), so text files that merely
 * contain a magic word at the right offset (HTML/SVG polyglots) are rejected.
 *
 * @param totalSize the object's full size, used to sanity-check box sizes
 */
export function sniffMedia(bytes: Uint8Array, totalSize: number): MediaType | null {
  if (bytes.length < 16) return null;
  const boxSize = u32(bytes, 0);

  // ISO BMFF (MP4, MOV, 3GP, HEIC, AVIF): starts with an "ftyp" box holding the
  // major brand, minor version and a list of 4-byte compatible brands.
  if (ascii(bytes, 4, "ftyp")) {
    if (boxSize < 16 || boxSize > 4096 || boxSize > totalSize || boxSize % 4 !== 0) return null;
    return isoBrand(String.fromCharCode(...bytes.slice(8, 12)));
  }
  // Older QuickTime files start with an 8-byte "wide" atom or straight with mdat/moov.
  if (ascii(bytes, 4, "wide") && boxSize === 8) return "video/quicktime";
  if (ascii(bytes, 4, "mdat") || ascii(bytes, 4, "moov")) {
    // 0 = runs to end of file, 1 = 64-bit size follows.
    if (boxSize === 0 || boxSize === 1 || (boxSize >= 8 && boxSize <= totalSize)) {
      return "video/quicktime";
    }
    return null;
  }
  // Matroska / WebM (EBML header, DocType appears within the first few bytes)
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    const head = String.fromCharCode(...bytes.slice(4, SNIFF_BYTES));
    if (head.includes("webm")) return "video/webm";
    if (head.includes("matroska")) return "video/x-matroska";
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, "PNG") &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) return "image/gif";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP") && ascii(bytes, 12, "VP8"))
    return "image/webp";
  return null;
}
