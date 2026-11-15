import { type ColorId, colorFor } from "@hop/shared";

/** Example athletes the landing page cycles through, each in their own colour. */
export const SHOWCASE: { handle: string; name: string; color: ColorId }[] = [
  { handle: "maya", name: "Maya", color: "coral" },
  { handle: "leo.flips", name: "Leo", color: "sky" },
  { handle: "nika", name: "Nika", color: "grape" },
  { handle: "tomas_bars", name: "Tomas", color: "sunflower" },
  { handle: "ines", name: "Ines", color: "mint" },
  { handle: "kai", name: "Kai", color: "bubblegum" },
];

export const showcaseHex = (i: number) => colorFor(SHOWCASE[i]?.color, "").hex;

/** Wraps around, so any index is valid. */
export function showcaseAt(i: number) {
  return (
    SHOWCASE[i % SHOWCASE.length] ?? { handle: "you", name: "You", color: "indigo" as ColorId }
  );
}

/** The athlete whose Hop the product stage shows, and the people filming her. */
export const STAGE_ATHLETE = { handle: "maya", name: "Maya", color: "coral" as ColorId };
export const STAGE_EVENT = "Prague Open";

export const FILMERS: { name: string; color: ColorId; file: string; size: string }[] = [
  { name: "Coach Tomas", color: "sky", file: "IMG_4821.MOV", size: "1.2 GB" },
  { name: "SmokyMonkey441", color: "mint", file: "PXL_20261201.mp4", size: "486 MB" },
  { name: "Ines", color: "bubblegum", file: "IMG_0937.MOV", size: "2.4 GB" },
];

export type Filmer = (typeof FILMERS)[number];

/** Wraps around in both directions, so any index is valid. */
export function filmerAt(i: number): Filmer {
  const n = FILMERS.length;
  return FILMERS[((i % n) + n) % n] as Filmer;
}
