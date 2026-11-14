import type { HopSummary, InboxFile, InboxPage } from "@hop/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CheckSquare,
  Download,
  Film,
  ImageIcon,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { RequireHandle } from "../components/RequireHandle";
import { ShareCard } from "../components/ShareCard";
import { api } from "../lib/api";
import { canStreamZip, downloadUrls, fileUrl, listAllFiles, zipToDisk } from "../lib/download";
import { formatBytes, formatDate, hopUrl } from "../lib/format";

function Contributor({ file, className = "" }: { file: InboxFile; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate">{file.contributorName ?? "Unknown"}</span>
      {file.contributorVerified && (
        <BadgeCheck className="size-3.5 shrink-0" aria-label="Signed in with Caliplaces" />
      )}
    </span>
  );
}

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

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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
  const staleTime = 10 * 60_000;
  const view = useQuery({
    queryKey: ["file-url", file.id],
    queryFn: () => fileUrl(file.id, false),
    staleTime,
  });
  // Fetched up front so the download is a plain link click, which every browser allows.
  const download = useQuery({
    queryKey: ["file-download", file.id],
    queryFn: () => fileUrl(file.id, true),
    staleTime,
  });
  useEscape(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{file.name}</p>
          <p className="flex min-w-0 gap-1 text-xs text-white/60">
            <Contributor file={file} /> · {formatBytes(file.size)} · {formatDate(file.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {download.data && (
            <a
              className="btn bg-white/10 px-3 py-2 hover:bg-white/20"
              href={download.data}
              title="Download"
            >
              <Download className="size-4" />
            </a>
          )}
          <button
            type="button"
            className="btn bg-white/10 px-3 py-2 hover:bg-white/20"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            type="button"
            className="btn bg-white/10 px-3 py-2 hover:bg-white/20"
            onClick={onClose}
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {view.data &&
          (file.mime.startsWith("image/") ? (
            <img src={view.data} alt={file.name} className="max-h-full max-w-full object-contain" />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: user-generated clips have no captions
            <video
              src={view.data}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full"
            />
          ))}
      </div>
      {file.note && <p className="px-4 pb-4 text-center text-sm text-white/80">“{file.note}”</p>}
    </div>
  );
}

/**
 * Where a zip can't be streamed to disk (Safari, Firefox, iOS), list each file
 * as its own download link: browsers block scripted multi-file downloads.
 */
function DownloadSheet({ files, onClose }: { files: InboxFile[]; onClose: () => void }) {
  const urls = useQuery({
    queryKey: ["download-urls", files.map((f) => f.id)],
    queryFn: () => downloadUrls(files.map((f) => f.id)),
    staleTime: 10 * 60_000,
  });
  useEscape(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-b-none sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <p className="text-lg font-black tracking-tight">Download {files.length} files</p>
          <button type="button" className="btn-ghost size-9 p-0" onClick={onClose} title="Close">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          This browser saves files one at a time. On a computer, Chrome or Edge can download
          everything as one zip.
        </p>
        <ul className="mt-4 divide-y divide-black/5 dark:divide-white/10">
          {files.map((file) => {
            const url = urls.data?.get(file.id);
            return (
              <li key={file.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="flex min-w-0 gap-1 text-xs text-black/50 dark:text-white/50">
                    <Contributor file={file} /> · {formatBytes(file.size)}
                  </p>
                </div>
                {url ? (
                  <a className="btn-ghost px-3 py-2" href={url}>
                    <Download className="size-4" />
                  </a>
                ) : (
                  <span className="px-3 text-xs text-black/40 dark:text-white/40">…</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function InboxView({ handle, activeHopId }: { handle: string; activeHopId: string | null }) {
  const queryClient = useQueryClient();
  const [hopFilter, setHopFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<InboxFile | null>(null);
  const [sheet, setSheet] = useState<InboxFile[] | null>(null);
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

  const download = async (which: "all" | "selected") => {
    setBusy(true);
    try {
      const load = async () =>
        which === "selected"
          ? files.filter((f) => selected.has(f.id))
          : filesQuery.hasNextPage
            ? await listAllFiles(hopFilter)
            : files;
      const count = which === "selected" ? selected.size : files.length;
      // The save dialog must open straight from the click, before any slow
      // loading, or the browser no longer treats it as user-initiated.
      if (canStreamZip() && (count > 1 || filesQuery.hasNextPage)) {
        await zipToDisk(load, `${handle}-hop.zip`);
      } else {
        setSheet(await load());
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        alert("Download failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const selecting = selected.size > 0;
  const pill = (active: boolean) =>
    `btn px-4 py-2 ${active ? "bg-ink text-paper dark:bg-paper dark:text-ink" : "bg-black/5 dark:bg-white/10"}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {/* onmyhop.com/<handle> always uploads into the live hop. */}
      {activeHop && <ShareCard url={hopUrl(handle)} title={activeHop.title} />}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={pill(hopFilter === null)}
          onClick={() => setHopFilter(null)}
        >
          All
        </button>
        {hops.data?.map((hop) => (
          <button
            key={hop.id}
            type="button"
            className={pill(hopFilter === hop.id)}
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
                onClick={() => download("selected")}
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
                onClick={() => download("all")}
              >
                <Download className="size-4" /> {busy ? "Preparing…" : "Download all"}
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
                <span className="absolute inset-x-0 bottom-0 flex bg-linear-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-left text-xs font-medium text-white">
                  <Contributor file={file} />
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
      {sheet && <DownloadSheet files={sheet} onClose={() => setSheet(null)} />}
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
