import type { UploadItem } from "../../lib/uploader";
import { queueSummary, summaryText } from "./progress";

/**
 * While files are sending: a floating glass pill at the foot of the screen,
 * as the app's floating controls, so how far along it is stays in view
 * however far down the list someone scrolls. Hidden from screen readers:
 * the list's summary already announces the same.
 */
export function SendingBar({ items }: { items: UploadItem[] }) {
  const summary = queueSummary(items);
  if (summary.active === 0) return null;
  const percent = Math.floor(summary.fraction * 100);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-float) flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="glass animate-fade-up flex w-full max-w-sm items-center gap-3 rounded-full py-2.5 pr-5 pl-2.5">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full text-[11px] font-bold text-on-accent tabular-nums"
          style={{
            background: `conic-gradient(var(--accent) ${percent}%, color-mix(in oklab, var(--accent) 25%, transparent) 0)`,
          }}
        >
          <span className="grid size-8 place-items-center rounded-full bg-accent">{percent}%</span>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{summaryText(summary)}</p>
          <p className="truncate text-xs text-muted">Keep this page open until it’s done</p>
        </div>
      </div>
    </div>
  );
}
