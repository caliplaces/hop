import type { HopSummary } from "@hop/shared";
import { Check, Copy, Lock, LockOpen, Radio } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { displayHopUrl, formatBytes, hopUrl } from "../../lib/format";
import { useCopy } from "../share/useCopy";
import { useHopMutations } from "./useHopMutations";

export function HopCard({ hop, handle, live }: { hop: HopSummary; handle: string; live: boolean }) {
  const url = hopUrl(handle, hop.slug);
  const { copied, copy } = useCopy(url);
  const { setStatus, makeLive } = useHopMutations();
  const closed = hop.status === "closed";

  return (
    <Card as="article" className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-lg font-semibold tracking-tight">{hop.title}</h2>
          {live && (
            <Badge tone="lime">
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
          className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate text-sm font-medium text-fg/80 hover:text-fg"
        >
          {copied ? (
            <Check className="size-3.5 shrink-0" />
          ) : (
            <Copy className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{displayHopUrl(url)}</span>
        </button>
      </div>
      <div className="flex gap-2">
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
        <IconButton
          label={closed ? "Reopen Hop" : "Close Hop"}
          bordered
          onClick={() => setStatus.mutate({ id: hop.id, status: closed ? "open" : "closed" })}
          disabled={setStatus.isPending}
        >
          {closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
        </IconButton>
      </div>
    </Card>
  );
}
