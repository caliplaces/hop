import { Check, Upload } from "lucide-react";

const ROWS = [
  { name: "muscle-up-final.mov", progress: 100 },
  { name: "front-lever.mp4", progress: 72 },
  { name: "IMG_2041.MOV", progress: 28 },
];

/**
 * The contributor screen, drawn in CSS: shows the product instead of a stock
 * image, costs no network request, and follows light/dark mode.
 */
export function PhoneMock() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-[280px] select-none sm:w-[300px]">
      <div className="absolute -inset-10 -z-10 rounded-full bg-hop/35 blur-3xl" />
      <div className="rounded-[3rem] border border-line-strong bg-surface p-3 shadow-lift">
        <div className="overflow-hidden rounded-[2.4rem] bg-canvas px-5 pt-10 pb-6">
          <div className="mx-auto mb-8 h-1.5 w-20 rounded-full bg-line-strong" />
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-full bg-hop text-xl font-semibold text-ink">
              M
            </span>
            <p className="mt-3 text-xs font-medium text-muted">@matej</p>
            <p className="mt-1 text-lg leading-tight font-bold tracking-tight">
              Send your clips to Matej
            </p>
          </div>
          <div className="mt-5 flex flex-col items-center rounded-3xl border-2 border-dashed border-line-strong bg-surface py-5">
            <span className="grid size-10 place-items-center rounded-full bg-hop text-ink">
              <Upload className="size-5" strokeWidth={2.2} />
            </span>
            <span className="mt-2 text-sm font-semibold">Choose videos & photos</span>
          </div>
          <ul className="mt-3 space-y-2.5 rounded-3xl border border-line bg-surface p-3">
            {ROWS.map((row) => (
              <li key={row.name} className="flex items-center gap-2.5">
                <span className="relative grid size-8 shrink-0 place-items-center rounded-xl bg-surface-2">
                  {row.progress === 100 && (
                    <span className="absolute inset-0 grid place-items-center rounded-xl bg-hop text-ink">
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">{row.name}</p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${row.progress === 100 ? "bg-hop-strong" : "bg-fg"}`}
                      style={{ width: `${row.progress}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
