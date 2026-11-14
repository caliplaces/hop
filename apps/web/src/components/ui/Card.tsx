import type { HTMLAttributes } from "react";
import { cx } from "./cx";

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article";
  flush?: boolean;
};

/** Rounded surface. `flush` removes padding for lists that manage their own rows. */
export function Card({ as: Tag = "section", flush, className, ...props }: CardProps) {
  return <Tag className={cx("card", flush && "p-0 sm:p-0", className)} {...props} />;
}
