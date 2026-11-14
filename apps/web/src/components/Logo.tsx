import { type ColorId, isColorId } from "@hop/shared";
import { Link } from "@tanstack/react-router";
import { cx } from "./ui/cx";

/** Hop's own colour for Bobble on pages that don't belong to an athlete. */
export const BRAND_COLOR: ColorId = "grape";

/** Bobble's face, pre-rendered per palette colour (see scripts/render-mascot-assets.mjs). */
export function LogoMark({
  color = BRAND_COLOR,
  className = "size-9",
}: {
  color?: string;
  className?: string;
}) {
  const id = isColorId(color) ? color : BRAND_COLOR;
  return (
    <img
      src={`/bobble/face-${id}.png`}
      alt=""
      width={128}
      height={128}
      className={cx("shrink-0", className)}
    />
  );
}

export function Logo({ color, className }: { color?: string; className?: string }) {
  return (
    <Link
      to="/"
      className={cx("inline-flex items-center gap-1.5", className)}
      aria-label="Hop home"
    >
      <LogoMark color={color} />
      <span className="text-xl font-bold tracking-tight">hop</span>
    </Link>
  );
}
