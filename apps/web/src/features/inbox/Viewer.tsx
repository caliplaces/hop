import type { InboxFile } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { fileUrl } from "../../lib/download";
import { formatBytes, formatDate } from "../../lib/format";
import { ContributorLabel } from "./ContributorLabel";

const URL_STALE_MS = 10 * 60_000; // signed URLs live 15 minutes

const overlayButton =
  "inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-95 disabled:opacity-30";

/** Full-screen player/photo view with previous/next (buttons, arrow keys). */
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
      // A dialog on top (e.g. "Delete this file?") owns the keyboard.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
    >
      <div className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <button type="button" className={overlayButton} onClick={onClose} aria-label="Close">
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">
            <ContributorLabel file={file} />
          </p>
          <p className="truncate text-xs text-white/60">
            {formatDate(file.createdAt)} · {formatBytes(file.size)}
          </p>
        </div>
        {download.data && (
          <a className={overlayButton} href={download.data} aria-label="Download">
            <Download className="size-5" />
          </a>
        )}
        <button
          type="button"
          className={overlayButton}
          onClick={() => onDelete(file)}
          aria-label="Delete"
        >
          <Trash2 className="size-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {view.data ? (
          file.mime.startsWith("image/") ? (
            <img src={view.data} alt={file.name} className="max-h-full max-w-full object-contain" />
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
          className={`${overlayButton} absolute left-3 hidden sm:inline-flex`}
          onClick={onPrev}
          disabled={!onPrev}
          aria-label="Previous"
        >
          <ChevronLeft className="size-6" />
        </button>
        <button
          type="button"
          className={`${overlayButton} absolute right-3 hidden sm:inline-flex`}
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next"
        >
          <ChevronRight className="size-6" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-6 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
        <button
          type="button"
          className={overlayButton}
          onClick={onPrev}
          disabled={!onPrev}
          aria-label="Previous"
        >
          <ChevronLeft className="size-6" />
        </button>
        <button
          type="button"
          className={overlayButton}
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next"
        >
          <ChevronRight className="size-6" />
        </button>
      </div>
      {file.note && <p className="px-6 pb-4 text-center text-sm text-white/80">“{file.note}”</p>}
    </div>
  );
}
