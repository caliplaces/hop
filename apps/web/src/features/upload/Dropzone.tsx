import { Plus, Upload } from "lucide-react";
import { useState } from "react";
import { cx } from "../../components/ui/cx";

const isMedia = (file: File) => !file.type || /^(video|image)\//.test(file.type);

/** The one big target: tap to pick from the camera roll, or drop files on desktop. */
export function Dropzone({
  compact,
  onFiles,
}: {
  compact: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const take = (list: FileList | null | undefined) => {
    const media = [...(list ?? [])].filter(isMedia);
    if (media.length) onFiles(media);
  };

  return (
    <label
      className={cx(
        "group flex cursor-pointer flex-col items-center rounded-[2rem] border-2 border-dashed px-6 text-center transition",
        compact ? "py-5" : "py-10",
        dragging
          ? "border-hop-strong bg-hop-soft"
          : "border-line-strong bg-surface hover:border-fg/30",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
    >
      <span
        className={cx(
          "grid place-items-center rounded-full bg-hop text-ink shadow-soft transition group-active:scale-95",
          compact ? "size-11" : "size-16",
        )}
      >
        {compact ? (
          <Plus className="size-5" strokeWidth={2.5} />
        ) : (
          <Upload className="size-7" strokeWidth={2.2} />
        )}
      </span>
      <span
        className={cx("font-semibold tracking-tight", compact ? "mt-3 text-base" : "mt-5 text-lg")}
      >
        {compact ? "Add more" : "Choose videos & photos"}
      </span>
      {!compact && (
        <span className="mt-1 text-sm text-muted">
          <span className="hidden sm:inline">or drop them here · </span>up to 5 GB each
        </span>
      )}
      <input
        type="file"
        className="sr-only"
        multiple
        accept="video/*,image/*"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}
