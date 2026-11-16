import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Plus, Share } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/Button";
import type { AthleteMe } from "../features/account/AccountDialog";
import { RequireAthlete } from "../features/account/RequireAthlete";
import { EventRow } from "../features/hops/EventRow";
import { NewHopDialog } from "../features/hops/NewHopDialog";
import { HopPass } from "../features/share/HopPass";
import { useCopy } from "../features/share/useCopy";
import { useQrCode } from "../features/share/useQrCode";
import { hopUrl } from "../lib/format";
import { queries } from "../lib/queries";

/**
 * My Hop, as the iPhone app's tab: the athlete's pass with the QR code and
 * ways to share the link, then their events and which one the link sends
 * clips to.
 */
function MyHopPage({ me }: { me: AthleteMe }) {
  const hops = useQuery(queries.hops());
  const url = hopUrl(me.handle);
  const qr = useQrCode(url, true);
  const { copied, copy } = useCopy(url);
  const [creating, setCreating] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  const stats = hops.data
    ? {
        clips: hops.data.reduce((sum, hop) => sum + hop.fileCount, 0),
        events: hops.data.length,
      }
    : null;

  const share = async () => {
    try {
      await navigator.share({ title: "Send me your clips", url });
    } catch {
      // Dismissed: nothing to do.
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-4xl font-bold tracking-tight">My Hop</h1>

      <div className="mt-6">
        <HopPass me={me} qr={qr} stats={stats} />
      </div>
      <p className="mt-5 text-center text-sm text-muted text-balance">
        Anyone can scan this or open the link to send you their clips. No app or account needed.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <button type="button" className="glass btn" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare ? (
          <button type="button" className="glass btn" onClick={share}>
            <Share className="size-4" /> Share
          </button>
        ) : (
          <a className="glass btn" href={url} target="_blank" rel="noreferrer">
            <Share className="size-4" /> Open
          </a>
        )}
        {qr ? (
          <a className="glass btn" href={qr} download={`hop-${me.handle}-qr.png`}>
            <Download className="size-4" /> Save QR
          </a>
        ) : (
          <button type="button" className="glass btn" disabled>
            <Download className="size-4" /> Save QR
          </button>
        )}
      </div>

      <section className="mt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Events</h2>
            <p className="mt-0.5 text-sm text-muted text-balance">
              Your link sends clips to one event at a time.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New event
          </Button>
        </div>
        <div className="mt-4 overflow-hidden rounded-(--radius-card) border border-line bg-surface shadow-soft">
          {hops.isPending ? (
            <div className="skeleton h-40" />
          ) : (
            <ul className="divide-y divide-line">
              {hops.data?.map((hop) => (
                <EventRow
                  key={hop.id}
                  hop={hop}
                  handle={me.handle}
                  live={hop.id === me.activeHopId}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <NewHopDialog handle={me.handle} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function MyHop() {
  return <RequireAthlete>{(me) => <MyHopPage me={me} />}</RequireAthlete>;
}
