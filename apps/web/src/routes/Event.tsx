import type { InboxFile } from "@hop/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ChevronLeft, Download, Link2, Lock } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import type { AthleteMe } from "../features/account/AccountDialog";
import { RequireAthlete } from "../features/account/RequireAthlete";
import { DownloadSheet } from "../features/inbox/DownloadSheet";
import { eventSummary } from "../features/inbox/EventCard";
import { FileGrid, FileGridSkeleton } from "../features/inbox/FileGrid";
import { LoadMore } from "../features/inbox/LoadMore";
import { SelectionBar } from "../features/inbox/SelectionBar";
import { useInboxActions } from "../features/inbox/useInboxActions";
import { Viewer } from "../features/inbox/Viewer";
import { queries } from "../lib/queries";

const route = getRouteApi("/app/events/$hopId");

/** One event's clips, as the app's: a grid to watch, pick out, download or delete. */
function EventPage({ me }: { me: AthleteMe }) {
  const { hopId } = route.useParams();
  const hops = useQuery(queries.hops());
  const hop = hops.data?.find((h) => h.id === hopId);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [viewingId, setViewingId] = useState<string | null>(null);

  const filesQuery = useInfiniteQuery(queries.files(hopId));
  const files = useMemo(
    () => filesQuery.data?.pages.flatMap((p) => p.files) ?? [],
    [filesQuery.data],
  );
  const actions = useInboxActions(me.handle);

  const toggle = useCallback(
    (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const open = useCallback((file: InboxFile) => setViewingId(file.id), []);
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const viewingIndex = viewingId ? files.findIndex((f) => f.id === viewingId) : -1;
  const viewing = viewingIndex >= 0 ? files[viewingIndex] : undefined;
  const prev = viewingIndex > 0 ? files[viewingIndex - 1] : undefined;
  const next = viewingIndex >= 0 ? files[viewingIndex + 1] : undefined;

  const deleteFromViewer = async (file: InboxFile) => {
    const neighbour = next ?? prev;
    if (await actions.remove([file.id])) setViewingId(neighbour?.id ?? null);
  };

  const downloadAll = () =>
    actions.download(
      async () => (filesQuery.hasNextPage ? actions.loadAll(hopId) : files),
      files.length,
      filesQuery.hasNextPage,
    );
  const downloadSelected = () => {
    const chosen = files.filter((f) => selected.has(f.id));
    return actions.download(async () => chosen, chosen.length, false);
  };

  if (hops.isSuccess && !hop) {
    return (
      <EmptyState
        title="This event isn’t here"
        action={
          <Link to="/app" className="btn-soft">
            Back to your inbox
          </Link>
        }
      >
        It may have been deleted, or it belongs to another account.
      </EmptyState>
    );
  }

  return (
    <>
      <Link
        to="/app"
        className="-ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-1 text-sm font-semibold text-muted transition hover:text-fg"
      >
        <ChevronLeft className="size-4" /> Inbox
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {(hop?.id === me.activeHopId || hop?.status === "closed") && (
            <div className="mb-2 flex gap-1.5">
              {hop?.id === me.activeHopId && (
                <span className="badge bg-accent-soft text-fg">
                  <Link2 className="size-3.5" /> Your link
                </span>
              )}
              {hop?.status === "closed" && (
                <span className="badge bg-surface-2 text-muted">
                  <Lock className="size-3" /> Closed
                </span>
              )}
            </div>
          )}
          <h1 className="truncate text-4xl font-bold tracking-tight">{hop?.title ?? " "}</h1>
          <p className="mt-1 text-[15px] text-muted tabular-nums">
            {hop ? eventSummary(hop) : " "}
          </p>
        </div>
        {files.length > 0 && !selecting && (
          <div className="flex gap-2">
            <Button variant="soft" onClick={() => setSelecting(true)}>
              Select
            </Button>
            <Button onClick={downloadAll} disabled={actions.downloading}>
              <Download className="size-4" /> {actions.downloading ? "Preparing…" : "Download all"}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6">
        {filesQuery.isPending ? (
          <FileGridSkeleton />
        ) : files.length === 0 ? (
          <EmptyState title="No clips here yet">
            {hop?.id === me.activeHopId
              ? "Clips people send to your link land here."
              : "Point your link at this event in My Hop, and clips people send land here."}
          </EmptyState>
        ) : (
          <FileGrid
            files={files}
            selecting={selecting}
            selected={selected}
            onOpen={open}
            onToggle={toggle}
            footer={
              filesQuery.hasNextPage && (
                <LoadMore
                  onLoad={() => filesQuery.fetchNextPage()}
                  loading={filesQuery.isFetchingNextPage}
                  failed={filesQuery.isFetchNextPageError}
                />
              )
            }
          />
        )}
      </div>

      {selecting && (
        <SelectionBar
          count={selected.size}
          total={files.length}
          onSelectAll={() => setSelected(new Set(files.map((f) => f.id)))}
          onClear={() => setSelected(new Set())}
          busy={actions.downloading || actions.removing}
          onCancel={stopSelecting}
          onDownload={downloadSelected}
          onDelete={async () => {
            if (await actions.remove([...selected])) stopSelecting();
          }}
        />
      )}
      {viewing && (
        <Viewer
          file={viewing}
          onClose={() => setViewingId(null)}
          onDelete={deleteFromViewer}
          onPrev={prev ? () => setViewingId(prev.id) : undefined}
          onNext={next ? () => setViewingId(next.id) : undefined}
        />
      )}
      <DownloadSheet files={actions.sheetFiles} onClose={actions.closeSheet} />
    </>
  );
}

export function Event() {
  return <RequireAthlete>{(me) => <EventPage me={me} />}</RequireAthlete>;
}
