import { type ColorId, PALETTE, textOn } from "@hop/shared";
import { Check } from "lucide-react";
import { useId } from "react";

/** The curated palette as native radios: arrow keys and screen readers work for free. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: ColorId;
  onChange: (id: ColorId) => void;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Page colour</legend>
      <div className="grid grid-cols-6 gap-2.5">
        {PALETTE.map((color) => {
          const checked = color.id === value;
          return (
            <label
              key={color.id}
              title={color.name}
              className="relative grid aspect-square cursor-pointer place-items-center rounded-full transition hover:scale-105 has-checked:scale-110 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-line-strong"
              style={{ backgroundColor: color.hex, color: textOn(color.hex) }}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={color.id}
                checked={checked}
                onChange={() => onChange(color.id)}
                aria-label={color.name}
              />
              {checked && <Check className="animate-pop size-4" strokeWidth={3} />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
