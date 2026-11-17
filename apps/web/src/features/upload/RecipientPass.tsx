import { colorFor, DEFAULT_HOP_SLUG, type PublicHop, textOn } from "@hop/shared";
import { CalendarDays } from "lucide-react";
import type { CSSProperties } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { ownerNames } from "./HopHero";

/**
 * Who the clips go to, as a small Hop pass in the athlete's colour: the same
 * card their QR code was shown on in the app. With the event's name when the
 * link sends clips to one.
 */
export function RecipientPass({ hop }: { hop: PublicHop }) {
  const { full } = ownerNames(hop);
  const { hex } = colorFor(hop.owner.color, hop.owner.handle);
  const ink = textOn(hex);
  const event = hop.slug !== DEFAULT_HOP_SLUG ? hop.title : null;
  // Chips on the card: a wash of its own text colour, readable on any palette colour.
  const chip = { background: `color-mix(in oklab, ${ink} 16%, transparent)` } as CSSProperties;

  return (
    <section
      aria-label={`Sending to ${full}`}
      className="animate-fade-up relative overflow-hidden rounded-[1.75rem] p-4 shadow-lift sm:p-5"
      style={{
        color: ink,
        background: `linear-gradient(150deg, color-mix(in oklab, ${hex} 92%, white), ${hex} 45%, color-mix(in oklab, ${hex} 72%, black))`,
      }}
    >
      {/* The pass's sheen, still: this card doesn't move. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-50 mix-blend-soft-light"
        style={{
          background:
            "radial-gradient(70% 80% at 25% 0%, rgb(255 255 255 / 0.75), transparent 65%), conic-gradient(from 210deg at 70% 30%, rgb(255 255 255 / 0), rgb(160 220 255 / 0.35), rgb(255 190 240 / 0.35), rgb(255 255 255 / 0))",
        }}
      />
      <div className="relative flex items-center gap-3">
        <span
          className="rounded-full"
          style={{ boxShadow: `0 0 0 2px color-mix(in oklab, ${ink} 30%, transparent)` }}
        >
          <Avatar name={full} src={hop.owner.avatarUrl} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide uppercase opacity-70">Sending to</p>
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-lg leading-tight font-bold">{full}</span>
            {hop.owner.hopPlus && (
              <span className="badge h-5 shrink-0 px-2 text-[11px]" style={chip}>
                Hop+
              </span>
            )}
          </p>
          {hop.owner.name && (
            <p className="truncate text-sm font-medium opacity-75">@{hop.owner.handle}</p>
          )}
        </div>
        <span aria-hidden="true" className="self-start text-sm font-bold tracking-tight opacity-80">
          hop
        </span>
      </div>
      {event && (
        <p
          className="relative mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
          style={chip}
        >
          <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{event}</span>
        </p>
      )}
    </section>
  );
}
