import { colorFor, textOn } from "@hop/shared";
import { showcaseAt } from "./showcase";

/**
 * "onmyhop.com/maya" → "/leo.flips" → …, each handle on its athlete's colour.
 * Palette colours are fills only (see colors.ts), so the handle sits on a chip.
 */
export function RotatingHandle({ index }: { index: number }) {
  const athlete = showcaseAt(index);
  const hex = colorFor(athlete.color, "").hex;
  return (
    <span className="inline-flex min-w-0 items-center [perspective:600px]">
      <span className="text-white/45">onmyhop.com/</span>
      <span
        className="ml-0.5 inline-flex min-w-0 rounded-md px-1.5 py-0.5 font-semibold transition-colors duration-500"
        style={{ backgroundColor: hex, color: textOn(hex) }}
      >
        <span key={athlete.handle} className="animate-slide-in inline-block truncate">
          {athlete.handle}
        </span>
      </span>
    </span>
  );
}
