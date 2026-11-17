import { Check, CircleAlert, Film, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { cx } from "../../components/ui/cx";
import { formatBytes } from "../../lib/format";
import type { Uploader, UploadItem } from "../../lib/uploader";
import { queueSummary, summaryText } from "./progress";

function useObjectUrl(file: File, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, enabled]);
  return url;
}

function statusText(item: UploadItem, progress: number): string {
  switch (item.status) {
    case "uploading":
      return `${Math.floor(progress * 100)}%`;
    case "finishing":
      return "Finishing…";
    case "queued":
      return "Waiting";
    case "done":
      return "Sent";
    default:
      return formatBytes(item.file.size);
  }
}

function UploadRow({ item, uploader }: { item: UploadItem; uploader: Uploader }) {
  const progress = item.file.size ? item.uploadedBytes / item.file.size : 0;
  const isImage = item.file.type.startsWith("image/");
  const preview = useObjectUrl(item.file, isImage);
  const active =
    item.status === "queued" || item.status === "uploading" || item.status === "finishing";
  const failed = item.status === "error";

  return (
    <li className="animate-fade-up flex items-center gap-3 py-3">
      <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 text-muted">
        {preview ? (
          <img src={preview} alt="" decoding="async" className="size-full object-cover" />
        ) : (
          <Film className="size-5" />
        )}
        {item.status === "done" && (
          <span className="animate-pop absolute inset-0 grid place-items-center bg-accent text-on-accent">
            <Check className="size-5" strokeWidth={3} />
          </span>
        )}
        {failed && (
          <span className="absolute inset-0 grid place-items-center bg-danger/85 text-white">
            <CircleAlert className="size-5" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[15px] font-medium">{item.file.name}</p>
          {!failed && (
            <p
              className={cx(
                "shrink-0 text-xs font-medium tabular-nums",
                item.status === "done" ? "text-fg" : "text-muted",
              )}
            >
              {statusText(item, progress)}
            </p>
          )}
        </div>
        {failed ? (
          <p className="mt-1 text-xs text-danger">{item.error}</p>
        ) : (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label={`Sending ${item.file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.status === "done" ? 100 : Math.floor(progress * 100)}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${item.status === "done" ? 100 : Math.max(3, progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {failed && (
        <IconButton label={`Retry ${item.file.name}`} onClick={() => uploader.retry(item.id)}>
          <RotateCcw className="size-4" />
        </IconButton>
      )}
      {(active || failed) && item.status !== "finishing" && (
        <IconButton
          label={`Cancel ${item.file.name}`}
          className="text-muted"
          onClick={() => uploader.cancel(item.id)}
        >
          <X className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

/** Every file being sent, in a glass card, with where the whole batch stands on top. */
export function UploadList({
  items,
  uploader,
  canClear,
}: {
  items: UploadItem[];
  uploader: Uploader;
  canClear: boolean;
}) {
  const summary = queueSummary(items);
  const shown = items.filter((i) => i.status !== "cancelled");
  if (shown.length === 0) return null;

  return (
    <section aria-label="Your files" className="glass rounded-(--radius-card) px-4 pt-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm font-semibold">
          {summaryText(summary)}
        </p>
        <p className="text-xs font-medium text-muted tabular-nums">
          {summary.active > 0 ? `${Math.floor(summary.fraction * 100)}%` : null}
        </p>
      </div>
      <ul className="mt-1 divide-y divide-line">
        {shown.map((item) => (
          <UploadRow key={item.id} item={item} uploader={uploader} />
        ))}
      </ul>
      {canClear && (
        <div className="flex justify-center border-t border-line py-3">
          <button
            type="button"
            className="rounded-full px-3 py-1 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
            onClick={() => uploader.clearFinished()}
          >
            Clear list
          </button>
        </div>
      )}
      {!canClear && <div className="h-1" />}
    </section>
  );
}
