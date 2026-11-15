import { cx } from "../../components/ui/cx";
import { LAUNCH_DAY, timeLeft, useNow } from "./launch";

const pad = (n: number) => String(n).padStart(2, "0");

/** Days, hours, minutes and seconds to launch; nothing once Hop is live. */
export function Countdown({ className }: { className?: string }) {
  const left = timeLeft(useNow());
  if (!left) return null;
  const units = [
    { label: "days", value: left.days },
    { label: "hours", value: left.hours },
    { label: "minutes", value: left.minutes },
    { label: "seconds", value: left.seconds },
  ];
  return (
    <div className={cx("flex justify-center", className)}>
      <p className="sr-only">Hop launches on {LAUNCH_DAY}, 2026.</p>
      <div aria-hidden="true" className="grid grid-cols-4 gap-2 sm:gap-3">
        {units.map(({ label, value }) => (
          <div
            key={label}
            className="flex w-[4.5rem] flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] py-3 backdrop-blur sm:w-24 sm:py-4"
          >
            <span className="overflow-hidden text-3xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              <span key={value} className="lp-digit">
                {pad(value)}
              </span>
            </span>
            <span className="mt-1 text-[11px] font-medium tracking-wider text-white/45 uppercase">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "14d 08h 21m 05s", for the launch badge. */
export function CountdownInline() {
  const left = timeLeft(useNow());
  if (!left) return null;
  return (
    <span aria-hidden="true" className="text-white/50 tabular-nums">
      {left.days}d {pad(left.hours)}h {pad(left.minutes)}m{" "}
      <span key={left.seconds} className="lp-digit">
        {pad(left.seconds)}s
      </span>
    </span>
  );
}
