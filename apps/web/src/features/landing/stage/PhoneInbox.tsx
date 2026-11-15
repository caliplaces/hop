import { colorFor, textOn } from "@hop/shared";
import { ChevronDown, Download } from "lucide-react";
import { LogoMark } from "../../../components/Logo";
import { STAGE_ATHLETE, STAGE_EVENT } from "../showcase";
import { ClipThumb, clipAt } from "./clips";

export const PHONE = { width: 300, height: 640 };

const VISIBLE = 15;

/** An iPhone showing Maya's inbox; `arrived` clips have come in since the page opened. */
export function PhoneInbox({ arrived, total }: { arrived: number; total: number }) {
  const accent = colorFor(STAGE_ATHLETE.color, "").hex;
  // Newest first. Keys are stable per clip, so only the newcomer animates in.
  const clips = Array.from({ length: VISIBLE }, (_, i) => clipAt(arrived + VISIBLE - 1 - i));

  return (
    <div
      className="relative rounded-[3.25rem] border border-white/12 bg-[#1b1b1e] p-[9px] shadow-[0_40px_120px_-30px_rgb(0_0_0/0.9),inset_0_0_0_1px_rgb(255_255_255/0.04)]"
      style={PHONE}
    >
      <div className="relative h-full overflow-hidden rounded-[2.75rem] bg-[#0d0d0f]">
        <div className="absolute top-[11px] left-1/2 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
        <div className="flex h-[46px] items-center justify-between px-7 pt-1 text-[13px] font-semibold text-white">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-px">
              {[4, 6, 8, 10].map((h) => (
                <span key={h} className="w-[3px] rounded-[1px] bg-white" style={{ height: h }} />
              ))}
            </span>
            <span className="ml-1 h-[11px] w-[22px] rounded-[3px] border border-white/50 p-px">
              <span className="block h-full w-3/4 rounded-[1.5px] bg-white" />
            </span>
          </span>
        </div>

        <div className="px-4 pt-3">
          <div className="flex items-center gap-2.5">
            <LogoMark color={STAGE_ATHLETE.color} className="size-9" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[17px] font-bold tracking-tight text-white">
                {STAGE_ATHLETE.name}’s Hop
              </p>
              <p className="text-[11px] text-white/50">onmyhop.com/{STAGE_ATHLETE.handle}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span
              className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-[12px] font-semibold"
              style={{ backgroundColor: `${accent}26`, color: accent }}
            >
              {STAGE_EVENT} <ChevronDown className="size-3.5" />
            </span>
            <span className="text-[12px] font-medium text-white/55 tabular-nums">
              <span key={total} className="lp-digit text-white">
                {total}
              </span>{" "}
              clips
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-[3px] px-[3px]">
          {clips.map((clip, i) => (
            <ClipThumb
              key={clip.id}
              clip={clip}
              showPlay={i === 0}
              className={`aspect-[3/4] rounded-[10px] ${i === 0 && arrived > 0 ? "lp-arrive" : ""}`}
            />
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0d0d0f] via-[#0d0d0f]/85 to-transparent" />
        <div className="absolute inset-x-4 bottom-8 flex justify-center">
          <span
            className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-semibold shadow-lg"
            style={{ backgroundColor: accent, color: textOn(accent) }}
          >
            <Download className="size-4" /> Download all
          </span>
        </div>
      </div>
    </div>
  );
}
