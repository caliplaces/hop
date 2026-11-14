import type { PublicHop } from "@hop/shared";
import { Avatar } from "../../components/ui/Avatar";
import { Badge } from "../../components/ui/Badge";

export function ownerNames(hop: PublicHop) {
  const full = hop.owner.name || `@${hop.owner.handle}`;
  const first = hop.owner.name?.split(" ")[0] || `@${hop.owner.handle}`;
  return { full, first };
}

/** Who you're sending to, and what happens to your clips. */
export function HopHero({
  hop,
  doneCount,
  allDone,
}: {
  hop: PublicHop;
  doneCount: number;
  allDone: boolean;
}) {
  const { full, first } = ownerNames(hop);
  return (
    <section className="animate-fade-up flex flex-col items-center text-center">
      <Avatar name={full} size="lg" />
      <div className="mt-4 flex items-center gap-2 text-sm font-medium text-muted">
        @{hop.owner.handle}
        {hop.slug !== "inbox" && <Badge tone="soft">{hop.title}</Badge>}
      </div>
      <h1 className="mt-2 text-[32px] leading-[1.1] font-bold tracking-tight text-balance">
        {allDone ? "Thank you! 🙌" : `Send your clips to ${first}`}
      </h1>
      <p className="mt-3 text-[15px] text-muted text-balance">
        {allDone
          ? `${doneCount} ${doneCount === 1 ? "file is" : "files are"} on the way to ${first}’s Hop.`
          : `Videos and photos you took. Only ${first} can see them.`}
      </p>
    </section>
  );
}
