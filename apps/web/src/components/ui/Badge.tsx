import type { ReactNode } from "react";
import { cx } from "./cx";

const tones = {
  lime: "bg-hop text-ink",
  soft: "bg-hop-soft text-fg",
  neutral: "bg-surface-2 text-muted",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return <span className={cx("badge", tones[tone])}>{children}</span>;
}
