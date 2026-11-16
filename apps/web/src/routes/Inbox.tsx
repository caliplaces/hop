import { colorFor } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QrCode } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import type { AthleteMe } from "../features/account/AccountDialog";
import { RequireAthlete } from "../features/account/RequireAthlete";
import { EventCard } from "../features/inbox/EventCard";
import { ExpiryNudge, isNearlyFull, StorageNudge } from "../features/inbox/Nudges";
import { Mascot } from "../features/mascot/Mascot";
import { HopPlusDialog } from "../features/plus/HopPlusOffer";
import { queries } from "../lib/queries";

/**
 * The inbox, as the iPhone app's: every event as a card with its newest
 * clips as the cover, and what to know about the plan above them.
 */
function InboxPage({ me }: { me: AthleteMe }) {
  const hops = useQuery(queries.hops());
  const plan = useQuery(queries.plan());
  const prices = useQuery(queries.prices());
  const [offering, setOffering] = useState(false);
  const totalClips = hops.data?.reduce((sum, hop) => sum + hop.fileCount, 0) ?? 0;
  const status = plan.data;
  // Hop+ on the website, where it's sold there.
  const getPlus =
    status?.plan === "free" && prices.data?.length ? () => setOffering(true) : undefined;

  return (
    <>
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Inbox</h1>
        <p className="mt-1 text-[15px] text-muted">
          {hops.isPending
            ? " "
            : totalClips === 1
              ? "1 clip from everyone who filmed you"
              : `${totalClips} clips from everyone who filmed you`}
        </p>
      </header>

      {status && (status.expiring || isNearlyFull(status)) && (
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {status.plan === "free" && status.expiring && (
            <ExpiryNudge expiring={status.expiring} onGetPlus={getPlus} />
          )}
          {isNearlyFull(status) && <StorageNudge status={status} onGetPlus={getPlus} />}
        </div>
      )}

      <div className="mt-6">
        {hops.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              <div key={i} className="skeleton h-60 rounded-(--radius-card)" />
            ))}
          </div>
        ) : totalClips === 0 ? (
          <EmptyState
            art={<Mascot state="sleep" color={colorFor(me.color, me.id).hex} size={170} />}
            title="No clips yet"
            action={
              <Link to="/app/my-hop" className={buttonClass({ variant: "primary" })}>
                <QrCode className="size-4" /> Show my QR code
              </Link>
            }
          >
            Share your link or QR code and tell people: “upload it on my Hop”.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {hops.data?.map((hop) => (
              <EventCard key={hop.id} hop={hop} color={me.color} live={hop.id === me.activeHopId} />
            ))}
          </div>
        )}
      </div>

      <HopPlusDialog open={offering} onClose={() => setOffering(false)} />
    </>
  );
}

export function Inbox() {
  return <RequireAthlete>{(me) => <InboxPage me={me} />}</RequireAthlete>;
}
