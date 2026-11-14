import type { ReactNode } from "react";

export type PillOption<T extends string> = { value: T; label: ReactNode; count?: number };

/** Single-choice filter as a horizontally scrollable row of pills. */
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
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="pill"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="tabular-nums opacity-60">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
