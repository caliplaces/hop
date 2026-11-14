import { Check, Film, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { formatBytes } from "../../lib/format";
import type { Uploader, UploadItem } from "../../lib/uploader";

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

function UploadRow({ item, uploader }: { item: UploadItem; uploader: Uploader }) {
  const progress = item.file.size ? item.uploadedBytes / item.file.size : 0;
  const isImage = item.file.type.startsWith("image/");
  const preview = useObjectUrl(item.file, isImage);
  const active =
    item.status === "queued" || item.status === "uploading" || item.status === "finishing";

  return (
    <li className="animate-fade-up flex items-center gap-3 py-3">
      <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 text-muted">
        {preview ? (
          <img src={preview} alt="" decoding="async" className="size-full object-cover" />
        ) : (
          <Film className="size-5" />
        )}
        {item.status === "done" && (
          <span className="animate-pop absolute inset-0 grid place-items-center bg-hop/90 text-ink">
            <Check className="size-5" strokeWidth={3} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[15px] font-medium">{item.file.name}</p>
          <p className="shrink-0 text-xs font-medium text-muted tabular-nums">
            {item.status === "uploading"
              ? `${Math.floor(progress * 100)}%`
              : item.status === "finishing"
                ? "Finishing…"
                : item.status === "queued"
                  ? "Waiting"
                  : item.status === "done"
                    ? "Sent"
                    : formatBytes(item.file.size)}
          </p>
        </div>
        {item.status === "error" ? (
          <p className="mt-1 text-xs text-danger">{item.error}</p>
        ) : (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${item.status === "done" ? "bg-hop-strong" : "bg-fg"}`}
              style={{ width: `${item.status === "done" ? 100 : Math.max(3, progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {item.status === "error" && (
        <IconButton label="Retry" onClick={() => uploader.retry(item.id)}>
          <RotateCcw className="size-4" />
        </IconButton>
      )}
      {(active || item.status === "error") && item.status !== "finishing" && (
        <IconButton label="Cancel" className="text-muted" onClick={() => uploader.cancel(item.id)}>
          <X className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

export function UploadList({
  items,
  uploader,
  canClear,
}: {
  items: UploadItem[];
  uploader: Uploader;
  canClear: boolean;
}) {
  return (
    <Card flush className="px-5 py-2 sm:px-6 sm:py-2">
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <UploadRow key={item.id} item={item} uploader={uploader} />
        ))}
      </ul>
      {canClear && (
        <div className="flex justify-center border-t border-line py-3">
          <button
            type="button"
            className="text-sm font-medium text-muted hover:text-fg"
            onClick={() => uploader.clearFinished()}
          >
            Clear list
          </button>
        </div>
      )}
    </Card>
  );
}
