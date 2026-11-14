/**
 * The curated palette athletes pick their page colour from. Each colour is
 * used only as a fill (buttons, mascot, highlights), never as text on the
 * page background, and gets ink or white text on top, whichever reads better.
 */
export const PALETTE = [
  { id: "coral", name: "Coral", hex: "#FF6B5B" },
  { id: "tangerine", name: "Tangerine", hex: "#FF9F1C" },
  { id: "sunflower", name: "Sunflower", hex: "#FFC93C" },
  { id: "mint", name: "Mint", hex: "#3DDC97" },
  { id: "teal", name: "Teal", hex: "#14B8A6" },
  { id: "sky", name: "Sky", hex: "#38BDF8" },
  { id: "ocean", name: "Ocean", hex: "#2563EB" },
  { id: "indigo", name: "Indigo", hex: "#5B5BF0" },
  { id: "grape", name: "Grape", hex: "#7C4DFF" },
  { id: "bubblegum", name: "Bubblegum", hex: "#F472B6" },
  { id: "cherry", name: "Cherry", hex: "#E11D48" },
  { id: "graphite", name: "Graphite", hex: "#3F3F46" },
] as const;

export type PaletteColor = (typeof PALETTE)[number];
export type ColorId = PaletteColor["id"];

export const COLOR_IDS = PALETTE.map((c) => c.id) as [ColorId, ...ColorId[]];

const INK = "#0B0B0C";
const WHITE = "#FFFFFF";

export function isColorId(value: unknown): value is ColorId {
  return typeof value === "string" && PALETTE.some((c) => c.id === value);
}

/** Stable pick for people who haven't chosen yet, so their page is never colourless. */
export function colorFor(id: string | null | undefined, seed: string): PaletteColor {
  const chosen = PALETTE.find((c) => c.id === id);
  if (chosen) return chosen;
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] as PaletteColor;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink or white, whichever is more readable on the given fill. */
export function textOn(hex: string): typeof INK | typeof WHITE {
  return contrast(hex, INK) >= contrast(hex, WHITE) ? INK : WHITE;
}
