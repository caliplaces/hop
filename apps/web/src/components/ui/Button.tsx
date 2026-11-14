import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Visual variants map 1:1 to the utilities in styles.css, so links and other
 * elements can share button styling via buttonClass() without a wrapper.
 *
 * Rules:
 * - `primary` (lime) is the one main action on a screen: Share, Claim it,
 *   Create Hop, Download all. Never two lime buttons side by side.
 * - `soft` / `outline` are secondary actions; `danger` only confirms deletion;
 *   `dark` is for confirming a non-destructive dialog.
 * - `className` is for layout (width, margins), never for colour or height,
 *   which the variant and size own.
 */
const variants = {
  primary: "btn-primary",
  dark: "btn-dark",
  soft: "btn-soft",
  outline: "btn-outline",
  danger: "btn-danger",
} as const;

const sizes = { sm: "btn-sm", md: "", lg: "btn-lg" } as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cx(variants[variant], sizes[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  bordered?: boolean;
};

export function IconButton({
  label,
  bordered,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx("btn-icon", bordered && "border border-line", className)}
      {...props}
    />
  );
}
