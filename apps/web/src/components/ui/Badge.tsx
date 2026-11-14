import type { ReactNode } from "react";
import { cx } from "./cx";

/** Tones are named for meaning, not colour, so usage reads as intent. */
const tones = {
  live: "bg-hop text-ink",
  event: "bg-hop-soft text-fg",
  muted: "bg-surface-2 text-muted",
} as const;

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return <span className={cx("badge", tones[tone])}>{children}</span>;
}
