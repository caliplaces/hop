/**
 * Rebuilds a JPEG from only what's needed to show it, so a profile photo is
 * served without anything hidden in it:
 *
 * - kept: the frame, its tables (DQT, DHT, DRI), the scans, and the JFIF and
 *   ICC colour profile segments (iPhones use Display P3);
 * - dropped: every other APPn segment (EXIF and its GPS location, XMP, IPTC
 *   and the like), comments, and anything after the end of the image;
 * - refused: anything that isn't a well-formed baseline or progressive
 *   Huffman JPEG of 1 or 3 components and at most MAX_SIDE on a side, such
 *   as lossless, arithmetic-coded or CMYK files, and huge ones that decode to
 *   hundreds of megabytes from a small file.
 *
 * The scans are copied byte for byte, so the picture decodes the same.
 * Returns null to refuse.
 */
export const MAX_SIDE = 2048;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
/** Baseline, extended sequential and progressive frames, all Huffman-coded. */
const FRAMES = new Set([0xc0, 0xc1, 0xc2]);
/** Quantisation and Huffman tables, and the restart interval. */
const TABLES = new Set([0xdb, 0xc4, 0xdd]);

export function sanitizeJpeg(input: Uint8Array): Uint8Array | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let sawFrame = false;
  let sawScan = false;
  const startsWith = (at: number, text: string) =>
    [...text].every((char, k) => input[at + k] === char.charCodeAt(0));

  let i = 2;
  while (i + 1 < input.length) {
    if (input[i] !== 0xff) return null;
    // Markers may be padded with extra 0xFF bytes.
    while (input[i + 1] === 0xff) i++;
    const marker = input[i + 1] ?? -1;

    if (marker === EOI) {
      if (!sawScan) return null;
      // Anything after the end of the image is dropped.
      parts.push(new Uint8Array([0xff, EOI]));
      return concat(parts);
    }

    if (i + 3 >= input.length) return null;
    const length = ((input[i + 2] ?? 0) << 8) | (input[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2 || end > input.length) return null;
    const segment = input.subarray(i, end);

    if (FRAMES.has(marker)) {
      // FF Cn, length, precision, height, width, components.
      if (sawFrame || length < 8) return null;
      const height = ((input[i + 5] ?? 0) << 8) | (input[i + 6] ?? 0);
      const width = ((input[i + 7] ?? 0) << 8) | (input[i + 8] ?? 0);
      const components = input[i + 9];
      if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return null;
      if (components !== 1 && components !== 3) return null;
      sawFrame = true;
      parts.push(segment);
    } else if (TABLES.has(marker)) {
      parts.push(segment);
    } else if (marker === 0xe0 && startsWith(i + 4, "JFIF\0")) {
      parts.push(segment);
    } else if (marker === 0xe2 && startsWith(i + 4, "ICC_PROFILE\0")) {
      parts.push(segment);
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      // Other APPn (EXIF, XMP, IPTC...) and comments: dropped.
    } else if (marker === SOS) {
      if (!sawFrame) return null;
      // The scan's coded data runs to the next marker that isn't a stuffed
      // byte (FF 00), a restart (FF D0 to D7) or padding (FF FF).
      let j = end;
      while (j + 1 < input.length) {
        if (input[j] === 0xff) {
          const next = input[j + 1] ?? 0;
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }
        j++;
      }
      parts.push(input.subarray(i, j));
      sawScan = true;
      i = j;
      continue;
    } else {
      // Lossless, arithmetic, hierarchical, DNL or unknown: not a photo the app makes.
      return null;
    }
    i = end;
  }
  // No end of image: truncated.
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
