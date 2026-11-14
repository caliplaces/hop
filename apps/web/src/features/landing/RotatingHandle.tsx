import { textOn } from "@hop/shared";
import { showcaseAt, showcaseHex } from "./showcase";

/** "onmyhop.com/maya" → "/leo.flips" → …, each athlete's link in their own colour. */
export function RotatingHandle({ index }: { index: number }) {
  const athlete = showcaseAt(index);
  const hex = showcaseHex(index);
  return (
    <span
      className="inline-flex max-w-full items-baseline rounded-[0.4em] px-[0.28em] pb-[0.06em] align-baseline transition-colors duration-500 [perspective:600px]"
      style={{ backgroundColor: hex, color: textOn(hex) }}
    >
      <span className="opacity-60">onmyhop.com/</span>
      <span key={athlete.handle} className="animate-slide-in inline-block truncate">
        {athlete.handle}
      </span>
    </span>
  );
}
