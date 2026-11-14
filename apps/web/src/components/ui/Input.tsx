import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "./cx";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };

export function Input({ className, ...props }: InputProps) {
  return <input className={cx("input", className)} {...props} />;
}

/** Input with a fixed prefix inside the same rounded field, e.g. "onmyhop.com/". */
export function PrefixedInput({ prefix, className, ...props }: InputProps & { prefix: ReactNode }) {
  return (
    <div
      className={cx(
        "flex h-12 items-center rounded-2xl border border-line-strong bg-surface transition focus-within:border-fg focus-within:ring-4 focus-within:ring-hop-soft",
        className,
      )}
    >
      <span className="shrink-0 pl-4 text-base text-subtle select-none">{prefix}</span>
      <input
        className="h-full min-w-0 flex-1 bg-transparent pr-4 text-base text-fg outline-none"
        {...props}
      />
    </div>
  );
}

export function FieldHint({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "danger" | "success";
  children: ReactNode;
}) {
  const color = { muted: "text-muted", danger: "text-danger", success: "text-fg" }[tone];
  return <p className={cx("mt-2 min-h-5 text-sm", color)}>{children}</p>;
}
