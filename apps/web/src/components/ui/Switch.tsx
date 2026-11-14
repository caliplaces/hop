import { type ReactNode, useId } from "react";

/** An on/off setting: a native checkbox with switch semantics, styled like the pills. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-4 has-disabled:cursor-default has-disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex h-7 w-12 shrink-0 rounded-full bg-line-strong transition has-checked:bg-fg has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent-soft">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 cursor-pointer appearance-none rounded-full outline-none disabled:cursor-default"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 left-0.5 size-6 rounded-full bg-surface shadow-sm transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}
