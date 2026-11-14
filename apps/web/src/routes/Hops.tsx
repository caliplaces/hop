import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/Button";
import type { AthleteMe } from "../features/account/AccountDialog";
import { RequireAthlete } from "../features/account/RequireAthlete";
import { HopCard } from "../features/hops/HopCard";
import { NewHopDialog } from "../features/hops/NewHopDialog";
import { ShareCard } from "../features/share/ShareCard";
import { hopUrl } from "../lib/format";
import { queries } from "../lib/queries";

function HopsPage({ me }: { me: AthleteMe }) {
  const hops = useQuery(queries.hops());
  const [creating, setCreating] = useState(false);
  const live = hops.data?.find((h) => h.id === me.activeHopId);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hops</h1>
          <p className="mt-1 text-[15px] text-muted text-balance">
            One per event. Your link uploads into the live one.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New Hop
        </Button>
      </div>

      {live && (
        <div className="mt-6">
          <ShareCard url={hopUrl(me.handle)} title={live.title} />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {hops.isPending
          ? Array.from({ length: 2 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              <div key={i} className="skeleton h-32 rounded-(--radius-card)" />
            ))
          : hops.data?.map((hop) => (
              <HopCard key={hop.id} hop={hop} handle={me.handle} live={hop.id === me.activeHopId} />
            ))}
      </div>

      <NewHopDialog handle={me.handle} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function Hops() {
  return <RequireAthlete>{(me) => <HopsPage me={me} />}</RequireAthlete>;
}
