import { colorFor, type PublicHop } from "@hop/shared";
import { Mascot, type MascotState } from "../mascot/Mascot";

export function ownerNames(hop: PublicHop) {
  const full = hop.owner.name || `@${hop.owner.handle}`;
  const first = hop.owner.name?.split(" ")[0] || `@${hop.owner.handle}`;
  return { full, first };
}

type Phase = "ready" | "sending" | "done";

const plural = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** Bobble, narrating, and where things stand. Who it's for is on the pass above. */
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
        // One size throughout: Bobble is made afresh for each size.
        size={140}
        follow
        interactive
        label={`Bobble, ${first}’s Hop mascot`}
      />
      {/* Not a live region: the upload list's summary already announces progress. */}
      <h1 className="mt-1 text-[32px] leading-[1.1] font-bold tracking-tight text-balance">
        {title}
      </h1>
      <p
        className={`mt-2.5 text-[15px] text-balance ${phase === "sending" ? "font-medium text-fg" : "text-muted"}`}
      >
        {body}
      </p>
    </section>
  );
}
