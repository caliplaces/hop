import { type ReactNode, useId } from "react";

export type PillOption<T extends string> = { value: T; label: ReactNode; count?: number };

/**
 * Single-choice filter as a horizontally scrollable row of pills. Built on
 * native radio inputs, so arrow keys, focus and screen readers work for free.
 */
export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    // min-w-0: a fieldset defaults to min-width: min-content, which would widen the page.
    <fieldset className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="pill">
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
          {option.count !== undefined && (
            <span className="tabular-nums opacity-60">{option.count}</span>
          )}
        </label>
      ))}
    </fieldset>
  );
}
