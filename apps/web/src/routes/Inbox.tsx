import type { InboxFile } from "@hop/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Download, Inbox as InboxIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Pills } from "../components/ui/Pills";
import type { AthleteMe } from "../features/account/AccountDialog";
import { RequireAthlete } from "../features/account/RequireAthlete";
import { DownloadSheet } from "../features/inbox/DownloadSheet";
import { FileGrid, FileGridSkeleton } from "../features/inbox/FileGrid";
import { LoadMore } from "../features/inbox/LoadMore";
import { SelectionBar } from "../features/inbox/SelectionBar";
import { useInboxActions } from "../features/inbox/useInboxActions";
import { Viewer } from "../features/inbox/Viewer";
import { ShareBar } from "../features/share/ShareBar";
import { hopUrl } from "../lib/format";
import { queries } from "../lib/queries";

const ALL = "all";
const route = getRouteApi("/app");

function InboxPage({ me }: { me: AthleteMe }) {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const filter = search.hop ?? ALL;
  const setFilter = (value: string) =>
    navigate({ search: value === ALL ? {} : { hop: value }, replace: true });
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [viewingId, setViewingId] = useState<string | null>(null);

  const hopId = filter === ALL ? null : filter;
  const hops = useQuery(queries.hops());
  const filesQuery = useInfiniteQuery(queries.files(hopId));
  const files = useMemo(
    () => filesQuery.data?.pages.flatMap((p) => p.files) ?? [],
    [filesQuery.data],
  );
  const actions = useInboxActions(me.handle);

  const activeHop = hops.data?.find((h) => h.id === me.activeHopId);
  const totalFiles = hops.data?.reduce((sum, h) => sum + h.fileCount, 0) ?? 0;

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

  const filterOptions = [
    { value: ALL, label: "All", count: totalFiles },
    ...(hops.data ?? []).map((h) => ({ value: h.id, label: h.title, count: h.fileCount })),
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inbox</h1>
          <p className="mt-1 text-[15px] text-muted">
            {totalFiles === 1 ? "1 file" : `${totalFiles} files`} from everyone who filmed you
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

      {activeHop && (
        <div className="mt-6">
          <ShareBar url={hopUrl(me.handle)} title={activeHop.title} />
        </div>
      )}

      {(hops.data?.length ?? 0) > 1 && (
        <div className="mt-6">
          <Pills
            label="Filter by Hop"
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
        </div>
      )}

      <div className="mt-5">
        {filesQuery.isPending ? (
          <FileGridSkeleton />
        ) : files.length === 0 ? (
          <EmptyState icon={InboxIcon} title="No clips yet">
            Share your link or QR code and tell people: “upload it on my Hop”.
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

export function Inbox() {
  return <RequireAthlete>{(me) => <InboxPage me={me} />}</RequireAthlete>;
}
