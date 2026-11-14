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
