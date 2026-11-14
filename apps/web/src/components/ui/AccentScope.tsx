import { colorFor, textOn } from "@hop/shared";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Paints a subtree in an athlete's palette colour: buttons, highlights and the
 * mascot pick it up through --accent / --on-accent / --mascot. Outside a scope
 * the accent is Hop's neutral ink.
 */
export function AccentScope({
  color,
  seed = "",
  className,
  children,
}: {
  color: string | null | undefined;
  seed?: string;
  className?: string;
  children: ReactNode;
}) {
  const { hex } = colorFor(color, seed);
  const style = { "--accent": hex, "--on-accent": textOn(hex), "--mascot": hex } as CSSProperties;
  return (
    <div className={cx("accent-scope", className)} style={style}>
      {children}
    </div>
  );
}
