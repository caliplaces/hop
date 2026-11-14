import { colorFor, DEFAULT_HOP_SLUG, type PublicHop } from "@hop/shared";
import { Badge } from "../../components/ui/Badge";
import { Mascot, type MascotState } from "../mascot/Mascot";

export function ownerNames(hop: PublicHop) {
  const full = hop.owner.name || `@${hop.owner.handle}`;
  const first = hop.owner.name?.split(" ")[0] || `@${hop.owner.handle}`;
  return { full, first };
}

type Phase = "ready" | "sending" | "done";

const plural = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** Who you're sending to, and where things stand. */
export function HopHero({
  hop,
  phase,
  doneCount,
  mascot,
}: {
  hop: PublicHop;
  phase: Phase;
  doneCount: number;
  mascot: MascotState;
}) {
  const { first } = ownerNames(hop);
  const title = {
    ready: `Send your clips to ${first}`,
    sending: `Sending to ${first}…`,
    done: `${plural(doneCount)} sent`,
  }[phase];
  const body = {
    ready: `Videos and photos you took. Only ${first} can see them.`,
    sending: "Keep this page open until everything is sent.",
    done: `They’re in ${first}’s Hop. Thanks for filming!`,
  }[phase];

  return (
    <section className="animate-fade-up flex flex-col items-center text-center">
      <Mascot
        state={mascot}
        color={colorFor(hop.owner.color, hop.owner.handle).hex}
        size={176}
        follow
        interactive
        label={`Bobble, ${first}’s Hop mascot`}
      />
      <div className="mt-1 flex items-center gap-2 text-sm font-medium text-muted">
        @{hop.owner.handle}
        {hop.slug !== DEFAULT_HOP_SLUG && <Badge tone="event">{hop.title}</Badge>}
      </div>
      <h1 className="mt-2 text-[32px] leading-[1.1] font-bold tracking-tight text-balance">
        {title}
      </h1>
      <p
        className={`mt-3 text-[15px] text-balance ${phase === "sending" ? "font-medium text-fg" : "text-muted"}`}
      >
        {body}
      </p>
    </section>
  );
}
