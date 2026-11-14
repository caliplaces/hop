import type { HopSummary } from "@hop/shared";
import { Link } from "@tanstack/react-router";
import { Check, Copy, Images, Lock, LockOpen, Radio } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { displayHopUrl, formatBytes, hopUrl } from "../../lib/format";
import { useCopy } from "../share/useCopy";
import { useHopMutations } from "./useHopMutations";

/** One Hop: state, size, its own link, and labelled actions (no mystery icons). */
export function HopCard({ hop, handle, live }: { hop: HopSummary; handle: string; live: boolean }) {
  const url = hopUrl(handle, hop.slug);
  const { copied, copy } = useCopy(url);
  const { setStatus, makeLive } = useHopMutations();
  const closed = hop.status === "closed";

  return (
    <Card as="article">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{hop.title}</h2>
        {live && (
          <Badge tone="live">
            <span className="size-1.5 animate-pulse rounded-full bg-ink" /> Live
          </Badge>
        )}
        {closed && <Badge>Closed</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {hop.fileCount} {hop.fileCount === 1 ? "file" : "files"} · {formatBytes(hop.totalBytes)}
      </p>
      <button
        type="button"
        onClick={copy}
        className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full text-sm font-medium text-muted hover:text-fg"
        title="Copy link"
      >
        {copied ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
        <span className="truncate">{displayHopUrl(url)}</span>
      </button>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/app"
          search={{ hop: hop.id }}
          className={buttonClass({ variant: "soft", size: "sm" })}
        >
          <Images className="size-4" /> View files
        </Link>
        {!live && !closed && (
          <Button
            variant="soft"
            size="sm"
            onClick={() => makeLive.mutate(hop.id)}
            disabled={makeLive.isPending}
          >
            <Radio className="size-4" /> Make live
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStatus.mutate({ id: hop.id, status: closed ? "open" : "closed" })}
          disabled={setStatus.isPending}
        >
          {closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
          {closed ? "Reopen" : "Close Hop"}
        </Button>
      </div>
    </Card>
  );
}
