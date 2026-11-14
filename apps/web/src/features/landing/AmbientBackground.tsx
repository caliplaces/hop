import { PALETTE } from "@hop/shared";

const BLOBS = [
  { color: "coral", className: "-top-32 -left-24 size-[28rem]", delay: "0s" },
  { color: "sky", className: "top-10 -right-32 size-[32rem]", delay: "-7s" },
  { color: "grape", className: "top-[28rem] left-1/3 size-[26rem]", delay: "-14s" },
] as const;

const hexOf = (id: string) => PALETTE.find((c) => c.id === id)?.hex;

/** Slow-drifting palette colour behind the hero; pure CSS, no JS per frame. */
export function AmbientBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {BLOBS.map((blob) => (
        <div
          key={blob.color}
          className={`animate-drift absolute rounded-full opacity-[0.16] blur-3xl dark:opacity-[0.12] ${blob.className}`}
          style={{ backgroundColor: hexOf(blob.color), animationDelay: blob.delay }}
        />
      ))}
    </div>
  );
}
