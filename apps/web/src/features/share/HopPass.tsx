import { colorFor, textOn } from "@hop/shared";
import { type CSSProperties, type PointerEvent, useRef } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { displayHopUrl, hopUrl } from "../../lib/format";
import type { AthleteMe } from "../account/AccountDialog";

/**
 * The athlete's Hop pass, as the iPhone app shows it: their colour, photo,
 * name and handle, and the QR code people scan to send clips. It leans
 * toward the pointer with a sheen across it, like the app's turning pass;
 * still for anyone who'd rather less motion.
 */
export function HopPass({
  me,
  qr,
  stats,
}: {
  me: AthleteMe;
  /** The QR code as an image URL, once drawn. */
  qr: string | null;
  stats: { clips: number; events: number } | null;
}) {
  const card = useRef<HTMLDivElement>(null);
  const { hex } = colorFor(me.color, me.id);
  const ink = textOn(hex);
  const name = me.name ?? `@${me.handle}`;
  const link = displayHopUrl(hopUrl(me.handle));

  const lean = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    card.current?.style.setProperty("--tilt-x", `${(0.5 - y) * 8}deg`);
    card.current?.style.setProperty("--tilt-y", `${(x - 0.5) * 10}deg`);
    card.current?.style.setProperty("--shine-x", `${x * 100}%`);
    card.current?.style.setProperty("--shine-y", `${y * 100}%`);
  };
  const settle = () => {
    for (const property of ["--tilt-x", "--tilt-y"])
      card.current?.style.setProperty(property, "0deg");
    card.current?.style.setProperty("--shine-x", "30%");
    card.current?.style.setProperty("--shine-y", "0%");
  };

  return (
    <div className="[perspective:1200px]" onPointerMove={lean} onPointerLeave={settle}>
      <div
        ref={card}
        className="relative overflow-hidden rounded-[2rem] p-6 shadow-lift transition-transform duration-300 ease-out [transform:rotateX(var(--tilt-x,0deg))_rotateY(var(--tilt-y,0deg))] sm:p-7"
        style={
          {
            color: ink,
            background: `linear-gradient(150deg, color-mix(in oklab, ${hex} 92%, white), ${hex} 45%, color-mix(in oklab, ${hex} 72%, black))`,
          } as CSSProperties
        }
      >
        {/* The holographic sheen, following the pointer. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60 mix-blend-soft-light"
          style={{
            background:
              "radial-gradient(70% 60% at var(--shine-x, 30%) var(--shine-y, 0%), rgb(255 255 255 / 0.75), transparent 65%), conic-gradient(from 210deg at 70% 30%, rgb(255 255 255 / 0), rgb(160 220 255 / 0.35), rgb(255 190 240 / 0.35), rgb(255 255 255 / 0))",
          }}
        />

        <div className="relative flex items-center gap-3">
          <Avatar name={name} src={me.avatarUrl} size="md" />
          <div className="min-w-0">
            <p className="truncate text-lg leading-tight font-bold">{name}</p>
            <p className="truncate text-sm font-medium opacity-75">@{me.handle}</p>
          </div>
          <span className="ml-auto text-sm font-bold tracking-tight opacity-80">hop</span>
        </div>

        <div className="relative mx-auto mt-6 w-full max-w-72 rounded-3xl bg-white p-4 shadow-soft">
          {qr ? (
            <img src={qr} alt={`QR code for ${link}`} className="aspect-square w-full" />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-black/5" />
          )}
        </div>

        <div className="relative mt-6 flex items-end justify-between text-sm font-semibold">
          <span className="truncate opacity-85">{link}</span>
          {stats && (
            <span className="tabular-nums opacity-75">
              {stats.clips === 1 ? "1 clip" : `${stats.clips} clips`} ·{" "}
              {stats.events === 1 ? "1 event" : `${stats.events} events`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
