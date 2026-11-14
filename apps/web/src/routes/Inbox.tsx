import type { HopSummary, InboxFile, InboxPage } from "@hop/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Download, Film, ImageIcon, Square, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RequireHandle } from "../components/RequireHandle";
import { ShareCard } from "../components/ShareCard";
import { api } from "../lib/api";
import { downloadFiles, fileUrl } from "../lib/download";
import { formatBytes, formatDate, hopUrl } from "../lib/format";

function Thumb({ file }: { file: InboxFile }) {
  const [failed, setFailed] = useState(false);
  const Icon = file.mime.startsWith("image/") ? ImageIcon : Film;
  if (!file.hasThumbnail || failed) {
    return (
      <div className="grid size-full place-items-center bg-black/5 dark:bg-white/10">
        <Icon className="size-8 opacity-40" />
      </div>
    );
  }
  return (
    <img
      src={`/api/me/files/${file.id}/thumbnail`}
      alt=""
      loading="lazy"
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function Viewer({
  file,
  onClose,
  onDelete,
}: {
  file: InboxFile;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { data: url } = useQuery({
    queryKey: ["file-url", file.id],
    queryFn: () => fileUrl(file.id, false),
    staleTime: 10 * 60_000,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{file.name}</p>
          <p className="text-xs text-white/60">
            {file.contributorName ?? "Unknown"} · {formatBytes(file.size)} ·{" "}
            {formatDate(file.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="btn bg-white/10 px-3 py-2 hover:bg-white/20"
            onClick={() => downloadFiles([file])}
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            className="btn bg-white/10 px-3 py-2 hover:bg-white/20"
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </button>
          <button
            type="button"
            className="btn bg-white/10 px-3 py-2 hover:bg-white/20"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {url &&
          (file.mime.startsWith("image/") ? (
            <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: user-generated clips have no captions
            <video src={url} controls autoPlay playsInline className="max-h-full max-w-full" />
          ))}
      </div>
      {file.note && <p className="px-4 pb-4 text-center text-sm text-white/80">“{file.note}”</p>}
    </div>
  );
}

function InboxView({ handle, activeHopId }: { handle: string; activeHopId: string | null }) {
  const queryClient = useQueryClient();
  const [hopFilter, setHopFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<InboxFile | null>(null);
  const [busy, setBusy] = useState(false);

  const hops = useQuery({
    queryKey: ["hops"],
    queryFn: () => api<{ hops: HopSummary[] }>("/me/hops").then((r) => r.hops),
  });
  const filesQuery = useInfiniteQuery({
    queryKey: ["files", hopFilter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (hopFilter) params.set("hopId", hopFilter);
      if (pageParam) params.set("cursor", pageParam);
      return api<InboxPage>(`/me/files?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const files = filesQuery.data?.pages.flatMap((p) => p.files) ?? [];
  const activeHop = hops.data?.find((h) => h.id === activeHopId);

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api(`/me/files/${id}`, { method: "DELETE" });
    },
    onSettled: () => {
      setSelected(new Set());
      setViewing(null);
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["hops"] });
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = async (list: InboxFile[]) => {
    setBusy(true);
    try {
      await downloadFiles(list, `${handle}-hop.zip`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        alert("Download failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const selectedFiles = files.filter((f) => selected.has(f.id));
  const selecting = selected.size > 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {activeHop && (
        // onmyhop.com/<handle> always uploads into the active hop.
        <ShareCard url={hopUrl(handle)} title={activeHop.title} />
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn px-4 py-2 ${hopFilter === null ? "bg-ink text-paper dark:bg-paper dark:text-ink" : "bg-black/5 dark:bg-white/10"}`}
          onClick={() => setHopFilter(null)}
        >
          All
        </button>
        {hops.data?.map((hop) => (
          <button
            key={hop.id}
            type="button"
            className={`btn px-4 py-2 ${hopFilter === hop.id ? "bg-ink text-paper dark:bg-paper dark:text-ink" : "bg-black/5 dark:bg-white/10"}`}
            onClick={() => setHopFilter(hop.id)}
          >
            {hop.title}
            <span className="opacity-60">{hop.fileCount}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {selecting ? (
            <>
              <button
                type="button"
                className="btn-ghost px-4 py-2"
                onClick={() => setSelected(new Set())}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-ghost px-4 py-2"
                disabled={busy}
                onClick={() => download(selectedFiles)}
              >
                <Download className="size-4" /> {selected.size}
              </button>
              <button
                type="button"
                className="btn bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                disabled={remove.isPending}
                onClick={() =>
                  confirm(`Delete ${selected.size} file(s)? This can't be undone.`) &&
                  remove.mutate([...selected])
                }
              >
                <Trash2 className="size-4" /> Delete
              </button>
            </>
          ) : (
            files.length > 0 && (
              <button
                type="button"
                className="btn-dark px-4 py-2"
                disabled={busy}
                onClick={() => download(files)}
              >
                <Download className="size-4" /> {busy ? "Downloading…" : "Download all"}
              </button>
            )
          )}
        </div>
      </div>

      {filesQuery.isPending ? (
        <p className="mt-10 text-center text-black/50 dark:text-white/50">Loading…</p>
      ) : files.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-2xl font-black tracking-tight">Nothing here yet</p>
          <p className="mt-2 text-black/60 dark:text-white/60">
            Share your link or QR code and say “upload it on my Hop”.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
          {files.map((file) => (
            <li
              key={file.id}
              className="group relative aspect-square overflow-hidden rounded-xl sm:rounded-2xl"
            >
              <button
                type="button"
                className="size-full"
                onClick={() => (selecting ? toggle(file.id) : setViewing(file))}
                title={`${file.name} from ${file.contributorName ?? "Unknown"}`}
              >
                <Thumb file={file} />
                <span className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-left text-xs font-medium text-white">
                  {file.contributorName ?? "Unknown"}
                </span>
              </button>
              <button
                type="button"
                className={`absolute top-1.5 left-1.5 rounded-md bg-black/40 p-1 text-white transition ${selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100 max-sm:opacity-70"}`}
                onClick={() => toggle(file.id)}
                aria-label={selected.has(file.id) ? "Deselect" : "Select"}
              >
                {selected.has(file.id) ? (
                  <CheckSquare className="size-4" />
                ) : (
                  <Square className="size-4" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {filesQuery.hasNextPage && (
        <div className="mt-6 text-center">
          <button
            type="button"
            className="btn-ghost"
            disabled={filesQuery.isFetchingNextPage}
            onClick={() => filesQuery.fetchNextPage()}
          >
            {filesQuery.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {viewing && (
        <Viewer
          file={viewing}
          onClose={() => setViewing(null)}
          onDelete={() =>
            confirm("Delete this file? This can't be undone.") && remove.mutate([viewing.id])
          }
        />
      )}
    </main>
  );
}

export function Inbox() {
  return (
    <RequireHandle>
      {(me) => <InboxView handle={me.handle} activeHopId={me.activeHopId} />}
    </RequireHandle>
  );
}
