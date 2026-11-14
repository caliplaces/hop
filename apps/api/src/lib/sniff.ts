/** How many leading bytes sniffMedia needs. */
export const SNIFF_BYTES = 512;

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Identify common video/image containers from their magic bytes. Uploads whose
 * content isn't recognisable media are rejected on completion.
 */
export function sniffMedia(bytes: Uint8Array): "video" | "image" | null {
  // ISO BMFF: MP4, MOV, M4V, 3GP, HEIC, AVIF ("....ftyp<brand>")
  if (ascii(bytes, 4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return "image";
    return "video";
  }
  // QuickTime files without a leading ftyp box
  if (
    ascii(bytes, 4, "moov") ||
    ascii(bytes, 4, "mdat") ||
    ascii(bytes, 4, "wide") ||
    ascii(bytes, 4, "free")
  ) {
    return "video";
  }
  // Matroska / WebM
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video";
  // MPEG-TS: sync byte every 188 bytes
  if (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) return "video";
  // RIFF containers
  if (ascii(bytes, 0, "RIFF")) {
    if (ascii(bytes, 8, "AVI ")) return "video";
    if (ascii(bytes, 8, "WEBP")) return "image";
    return null;
  }
  // JPEG, PNG, GIF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
  if (bytes[0] === 0x89 && ascii(bytes, 1, "PNG")) return "image";
  if (ascii(bytes, 0, "GIF8")) return "image";
  return null;
}
