import type { HopSummary } from "@hop/shared";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, Copy, Link2, Lock, LockOpen } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { hopUrl } from "../../lib/format";
import { eventSummary } from "../inbox/EventCard";
import { useCopy } from "../share/useCopy";
import { useHopMutations } from "./useHopMutations";

/**
 * One event in My Hop: where its clips are, whether the athlete's link sends
 * clips to it, and what can be done with it, each action labelled.
 */
export function EventRow({
  hop,
  handle,
  live,
}: {
  hop: HopSummary;
  handle: string;
  live: boolean;
}) {
  const { copied, copy } = useCopy(hopUrl(handle, hop.slug));
  const { setStatus, makeLive } = useHopMutations();
  const closed = hop.status === "closed";

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <Link
        to="/app/events/$hopId"
        params={{ hopId: hop.id }}
        className="group flex min-w-0 flex-1 items-center gap-2"
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate font-semibold">
            {hop.title}
            {live && (
              <span className="badge bg-accent text-on-accent">
                <Link2 className="size-3.5" /> Your link
              </span>
            )}
            {closed && (
              <span className="badge bg-surface-2 text-muted">
                <Lock className="size-3" /> Closed
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-muted tabular-nums">{eventSummary(hop)}</p>
        </div>
        <ChevronRight className="ml-auto size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5" />
      </Link>
      <div className="flex flex-wrap gap-2">
        {!live && !closed && (
          <Button
            variant="soft"
            size="sm"
            onClick={() => makeLive.mutate(hop.id)}
            disabled={makeLive.isPending}
          >
            <Link2 className="size-4" /> Send my link here
          </Button>
        )}
        <Button variant="soft" size="sm" onClick={copy} aria-label={`Copy ${hop.title}’s own link`}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Its link
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStatus.mutate({ id: hop.id, status: closed ? "open" : "closed" })}
          disabled={setStatus.isPending}
        >
          {closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
          {closed ? "Reopen" : "Close"}
        </Button>
      </div>
    </li>
  );
}
