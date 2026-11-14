import type { CSSProperties } from "react";
import { cx } from "../../components/ui/cx";
import type { MascotState } from "./engine/motion";

/**
 * A CSS-only Bobble shown instantly while the 3D mascot loads, and kept where
 * 3D isn't available (no WebGL2, data saver). Scales with its container.
 */
export function MascotPoster({
  color,
  state,
  className,
}: {
  color: string;
  state: MascotState;
  className?: string;
}) {
  const asleep = state === "sleep";
  const style = {
    "--mascot": color,
    background: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${color} 62%, white), ${color} 58%, color-mix(in oklab, ${color} 82%, black))`,
  } as CSSProperties;
  const eye = asleep ? (
    <span className="block h-[8%] w-[16%] rounded-full bg-[#17171c]" />
  ) : (
    <span className="relative block h-[22%] w-[17%] rounded-full bg-[#17171c]">
      <span className="absolute top-[18%] left-[22%] size-[34%] rounded-full bg-white" />
    </span>
  );
  return (
    <div aria-hidden="true" className={cx("pointer-events-none absolute inset-0", className)}>
      <div className="absolute inset-0 motion-safe:animate-[mascot-bob_2.8s_ease-in-out_infinite]">
        {/* antenna + pompom */}
        <span
          className="absolute top-[12%] left-1/2 h-[12%] w-[1.6%] -translate-x-1/2 rounded-full"
          style={{ background: color }}
        />
        <span
          className="absolute top-[7%] left-1/2 size-[11%] -translate-x-1/2 rounded-full"
          style={style}
        />
        {/* body */}
        <div
          className="absolute top-[22%] right-[15%] bottom-[14%] left-[15%] rounded-[48%_48%_44%_44%/58%_58%_42%_42%] shadow-[inset_0_-10px_24px_rgb(0_0_0/0.12)]"
          style={style}
        >
          <div className="absolute inset-x-[22%] top-[44%] flex items-center justify-between">
            {eye}
            {eye}
          </div>
          <span className="absolute top-[58%] left-[14%] h-[9%] w-[16%] rounded-full bg-[#ff8a9e] opacity-70" />
          <span className="absolute top-[58%] right-[14%] h-[9%] w-[16%] rounded-full bg-[#ff8a9e] opacity-70" />
        </div>
        {/* paws */}
        <span
          className="absolute bottom-[10%] left-[30%] h-[7%] w-[14%] rounded-full"
          style={{ background: color }}
        />
        <span
          className="absolute right-[30%] bottom-[10%] h-[7%] w-[14%] rounded-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}
