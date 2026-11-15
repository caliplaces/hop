import type { ColorId } from "@hop/shared";
import { colorFor } from "@hop/shared";
import { Play } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "../../../components/ui/cx";

/*
 * Stand-ins for video thumbnails: a gradient in two palette colours and a
 * pictogram of a calisthenics move, drawn on a 40×40 grid with round strokes.
 */
const MOVES = {
  handstand: {
    paths: ["M15 36 L20 27 L25 36", "M20 27 V15", "M20 15 L16 4 M20 15 L24 4"],
    head: [20, 31],
  },
  flag: {
    paths: ["M7 3 V38", "M7 10 L13 15 L7 21", "M13 15 H26", "M26 15 L37 13 M26 15 L37 18"],
    head: [15, 10.5],
  },
  lever: { paths: ["M4 8 H36", "M17 8 V14", "M17 14 H28", "M28 14 H38"], head: [12.5, 14] },
  muscleUp: {
    paths: ["M4 22 H36", "M15 22 L20 14 L25 22", "M20 14 V25", "M20 25 L17 36 M20 25 L23 36"],
    head: [20, 9.5],
  },
  planche: { paths: ["M14 26 V36", "M14 26 L26 25", "M26 25 L38 24.5"], head: [9.5, 25] },
  jump: {
    paths: ["M20 12 V22", "M20 14 L11 6 M20 14 L29 6", "M20 22 L13 34 M20 22 L27 34"],
    head: [20, 7.5],
  },
} as const;

export type Move = keyof typeof MOVES;
export const MOVE_IDS = Object.keys(MOVES) as Move[];

export type Clip = { id: string; move: Move; from: ColorId; to: ColorId; duration: string };

export function Pictogram({ move, className }: { move: Move; className?: string }) {
  const { paths, head } = MOVES[move];
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <circle cx={head[0]} cy={head[1]} r={3.1} fill="currentColor" />
    </svg>
  );
}

export function ClipThumb({
  clip,
  className,
  style,
  showPlay = false,
  size = "md",
}: {
  clip: Clip;
  className?: string;
  style?: CSSProperties;
  showPlay?: boolean;
  size?: "sm" | "md";
}) {
  const from = colorFor(clip.from, "").hex;
  const to = colorFor(clip.to, "").hex;
  return (
    <div
      className={cx("relative isolate overflow-hidden", className)}
      style={{ ...style, background: `linear-gradient(155deg, ${from}, ${to})` }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_110%,rgb(0_0_0/0.45),transparent_60%)]" />
      <Pictogram
        move={clip.move}
        className={cx(
          "absolute inset-0 m-auto text-white/90",
          size === "sm" ? "size-[62%]" : "size-[58%]",
        )}
      />
      {showPlay && (
        <span className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-black/35 backdrop-blur-sm">
          <Play className="size-2.5 fill-white text-white" />
        </span>
      )}
      <span
        className={cx(
          "absolute right-1 bottom-1 rounded-md bg-black/45 font-semibold text-white tabular-nums backdrop-blur-sm",
          size === "sm" ? "px-1 text-[8px]" : "px-1.5 py-px text-[10px]",
        )}
      >
        {clip.duration}
      </span>
    </div>
  );
}

const PAIRS: [ColorId, ColorId][] = [
  ["coral", "tangerine"],
  ["sky", "indigo"],
  ["grape", "bubblegum"],
  ["mint", "teal"],
  ["sunflower", "coral"],
  ["ocean", "grape"],
  ["bubblegum", "cherry"],
  ["teal", "sky"],
  ["tangerine", "sunflower"],
];

/** A deterministic clip for any index, so the page renders the same every time. */
export function clipAt(i: number): Clip {
  const pair = PAIRS[i % PAIRS.length] ?? PAIRS[0];
  const move = MOVE_IDS[(i * 5) % MOVE_IDS.length] ?? "jump";
  const seconds = 6 + ((i * 7) % 49);
  return {
    id: `clip-${i}`,
    move,
    from: pair?.[0] ?? "coral",
    to: pair?.[1] ?? "grape",
    duration: `0:${String(seconds).padStart(2, "0")}`,
  };
}
