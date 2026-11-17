import { isAcceptableDeclaredType } from "@hop/shared";
import { ImagePlus, Plus } from "lucide-react";
import { useState } from "react";
import { cx } from "../../components/ui/cx";
import { useFeedback } from "../../components/ui/feedback";

/**
 * The one big target: tap to pick from the camera roll, or drop files on
 * desktop. Glass, with the athlete's colour on its button and when dragging.
 */
export function Dropzone({
  compact,
  onFiles,
}: {
  compact: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const { toast } = useFeedback();
  /** Same rule as the server's early check; the server has the final say from the bytes. */
  const take = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])];
    const media = files.filter((f) => isAcceptableDeclaredType(f.type));
    const skipped = files.length - media.length;
    if (skipped) {
      toast(
        skipped === 1
          ? "Skipped 1 file that isn’t a video or photo"
          : `Skipped ${skipped} files that aren’t videos or photos`,
        "error",
      );
    }
    if (media.length) onFiles(media);
  };

  return (
    <label
      className={cx(
        "glass group flex cursor-pointer items-center rounded-[2rem] transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent-soft",
        compact ? "gap-4 px-4 py-3.5" : "flex-col px-6 py-9 text-center",
        dragging && "ring-4 ring-accent",
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
          "grid shrink-0 place-items-center rounded-full bg-accent text-on-accent shadow-soft transition group-hover:scale-105 group-active:scale-95",
          compact ? "size-11" : "size-[4.5rem]",
        )}
      >
        {compact ? (
          <Plus className="size-5" strokeWidth={2.5} />
        ) : (
          <ImagePlus className="size-8" strokeWidth={2} />
        )}
      </span>
      <span className={cx("flex flex-col", !compact && "items-center")}>
        <span
          className={cx("font-semibold tracking-tight", compact ? "text-base" : "mt-5 text-lg")}
        >
          {compact ? "Add more" : "Choose videos & photos"}
        </span>
        <span className={cx("text-sm text-muted", !compact && "mt-1")}>
          {dragging ? (
            "Drop them to send"
          ) : (
            <>
              <span className="hidden sm:inline">or drop them here · </span>up to 5 GB each
            </>
          )}
        </span>
      </span>
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
