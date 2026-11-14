import type { InboxFile } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Trash2, X } from "lucide-react";
import { type TouchEvent, useEffect, useRef } from "react";
import { useModalDialog } from "../../components/ui/useModalDialog";
import { fileUrl } from "../../lib/download";
import { formatBytes, formatDate } from "../../lib/format";
import { ContributorLabel } from "./ContributorLabel";

const URL_STALE_MS = 10 * 60_000; // signed URLs live 15 minutes
const SWIPE_PX = 60;

// Layout classes (display, position) are added per use, never baked in here.
const roundButton =
  "items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-95 disabled:opacity-30 size-11";

/**
 * Full-screen viewer on a native modal <dialog> (focus trap, Esc, inert page).
 * Desktop: side arrows and arrow keys. Phone: swipe left/right, so nothing sits
 * on top of the video's own controls.
 */
export function Viewer({
  file,
  onClose,
  onDelete,
  onPrev,
  onNext,
}: {
  file: InboxFile;
  onClose: () => void;
  onDelete: (file: InboxFile) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const dialog = useModalDialog(true);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const view = useQuery({
    queryKey: ["file-url", file.id],
    queryFn: () => fileUrl(file.id, false),
    staleTime: URL_STALE_MS,
  });
  // Resolved up front so downloading is a plain link click, which every browser allows.
  const download = useQuery({
    queryKey: ["file-download", file.id],
    queryFn: () => fileUrl(file.id, true),
    staleTime: URL_STALE_MS,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Another dialog on top (e.g. "Delete this file?") owns the keyboard, and
      // arrows on the video (seeking) or a field belong to that element. Buttons
      // don't use arrows, and the dialog focuses its Close button on open.
      if (e.defaultPrevented || document.querySelectorAll("dialog[open]").length > 1) return;
      if (
        e.target instanceof Element &&
        e.target.closest("video, input, select, textarea, [role=slider]")
      )
        return;
      const go = e.key === "ArrowLeft" ? onPrev : onNext;
      if (!go) return;
      e.preventDefault();
      go();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    const t = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(t.clientY - start.y)) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  return (
    <dialog
      ref={dialog}
      aria-label={`${file.name} from ${file.contributorName ?? "unknown"}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <button
            type="button"
            className={`inline-flex ${roundButton}`}
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-[15px] font-semibold">
              <ContributorLabel file={file} />
            </p>
            <p className="truncate text-xs text-white/60">
              {file.name} · {formatBytes(file.size)} · {formatDate(file.createdAt)}
            </p>
          </div>
          {download.data && (
            <a className={`inline-flex ${roundButton}`} href={download.data} aria-label="Download">
              <Download className="size-5" />
            </a>
          )}
          <button
            type="button"
            className={`inline-flex ${roundButton}`}
            onClick={() => onDelete(file)}
            aria-label="Delete"
          >
            <Trash2 className="size-5" />
          </button>
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center pb-[env(safe-area-inset-bottom)]"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {view.data ? (
            file.mime.startsWith("image/") ? (
              <img
                src={view.data}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: user-generated clips have no captions
              <video
                key={file.id}
                src={view.data}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full"
              />
            )
          ) : (
            <div className="skeleton aspect-video w-2/3 rounded-3xl opacity-20" />
          )}
          <button
            type="button"
            className={`absolute left-4 hidden sm:inline-flex ${roundButton}`}
            onClick={onPrev}
            disabled={!onPrev}
            aria-label="Previous"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            className={`absolute right-4 hidden sm:inline-flex ${roundButton}`}
            onClick={onNext}
            disabled={!onNext}
            aria-label="Next"
          >
            <ChevronRight className="size-6" />
          </button>
        </div>
        {file.note && <p className="px-6 pb-4 text-center text-sm text-white/80">“{file.note}”</p>}
      </div>
    </dialog>
  );
}
