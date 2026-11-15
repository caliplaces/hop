import { colorFor, textOn } from "@hop/shared";
import { Check, Mail } from "lucide-react";
import type { CSSProperties } from "react";
import { LogoMark } from "../../../components/Logo";
import { cx } from "../../../components/ui/cx";
import { FILMERS, type Filmer, STAGE_ATHLETE, STAGE_EVENT } from "../showcase";
import { ClipThumb, clipAt } from "./clips";

const glass =
  "rounded-[1.4rem] border border-white/10 bg-[#161619]/80 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl";

function Initial({ name, color, className }: { name: string; color: string; className?: string }) {
  const hex = colorFor(color, name).hex;
  return (
    <span
      className={cx("grid shrink-0 place-items-center rounded-full font-bold", className)}
      style={{ backgroundColor: hex, color: textOn(hex) }}
    >
      {name[0]}
    </span>
  );
}

export type FilmerState = "waiting" | "sending" | "sent";

/** A filmer sending clips from their phone's browser. `run` restarts the progress animation. */
export function UploadCard({
  filmer,
  state,
  run,
  className,
  style,
}: {
  filmer: Filmer;
  state: FilmerState;
  run: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx(glass, "w-[280px] p-4 transition-opacity duration-500", className)}
      style={style}
    >
      <div className="flex items-center gap-2.5">
        <Initial name={filmer.name} color={filmer.color} className="size-8 text-[13px]" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-white">{filmer.name}</p>
          <p className="text-[11px] text-white/45">to onmyhop.com/{STAGE_ATHLETE.handle}</p>
        </div>
        {state === "sent" && (
          <span className="grid size-6 place-items-center rounded-full bg-[#3DDC97] text-black">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="mt-3.5 flex items-center justify-between text-[11px]">
        <span className="truncate font-medium text-white/75">{filmer.file}</span>
        <span className="text-white/45 tabular-nums">{filmer.size}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        {state === "sending" && (
          <div
            key={run}
            className="lp-progress h-full rounded-full bg-white"
            style={{ "--lp-fill": "1.5s" } as CSSProperties}
          />
        )}
        {state === "sent" && <div className="h-full rounded-full bg-[#3DDC97]" />}
      </div>
      <p className="mt-2 text-[11px] font-medium text-white/50">
        {state === "sending" ? "Sending…" : state === "sent" ? "Sent · original quality" : "Ready"}
      </p>
    </div>
  );
}

/** Event mode's Live Activity on the iPhone Lock Screen. */
export function LiveActivity({ total, people }: { total: number; people: number }) {
  return (
    <div className="w-[300px] rounded-[1.9rem] border border-white/10 bg-black/70 p-4 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <LogoMark color={STAGE_ATHLETE.color} className="size-11" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[15px] font-semibold text-white">{STAGE_EVENT}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-white/50">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#FF6B5B]" />
              <span className="relative size-1.5 rounded-full bg-[#FF6B5B]" />
            </span>
            Event mode · live
          </p>
        </div>
        <div className="text-right leading-none">
          <p className="text-[34px] font-bold tracking-tight text-white tabular-nums">
            <span key={total} className="lp-digit">
              {total}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-white/50">clips</p>
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between border-t border-white/8 pt-3">
        <div className="flex -space-x-1.5">
          {FILMERS.map((f) => (
            <Initial
              key={f.name}
              name={f.name}
              color={f.color}
              className="size-6 text-[10px] ring-2 ring-black"
            />
          ))}
        </div>
        <p className="text-[11px] font-medium text-white/55">{people} people filmed you</p>
      </div>
    </div>
  );
}

/** A push notification for the latest arrival. */
export function ArrivalNotice({ from, count }: { from: string; count: number }) {
  return (
    <div className={cx(glass, "w-[300px] rounded-[1.6rem] p-3.5")}>
      <div className="flex items-center gap-2 text-[11px] text-white/45">
        <span className="grid size-5 place-items-center overflow-hidden rounded-[6px] bg-white/10">
          <LogoMark className="size-5" />
        </span>
        <span className="font-semibold tracking-wide text-white/70 uppercase">Hop</span>
        <span className="ml-auto">now</span>
      </div>
      <p key={from} className="lp-digit mt-2 text-[13px] font-semibold text-white">
        {count === 1 ? "A new clip" : `${count} new clips`} from {from}
      </p>
      <p className="mt-0.5 text-[12px] text-white/55">{STAGE_EVENT} · tap to watch</p>
    </div>
  );
}

/** The new-clips digest email. */
export function DigestEmail() {
  return (
    <div className={cx(glass, "w-[300px] p-4")}>
      <div className="flex items-center gap-2 text-[11px] text-white/45">
        <Mail className="size-3.5" />
        <span>Hop · hello@onmyhop.com</span>
      </div>
      <p className="mt-2 text-[14px] font-semibold text-white">12 new clips on your Hop</p>
      <p className="mt-0.5 text-[12px] text-white/55">From 5 people at {STAGE_EVENT}</p>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[3, 7, 11, 16].map((i) => (
          <ClipThumb key={i} clip={clipAt(i)} size="sm" className="aspect-square rounded-lg" />
        ))}
      </div>
    </div>
  );
}
