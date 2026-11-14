import type { InboxFile } from "@hop/shared";
import { Check, Film, ImageIcon } from "lucide-react";
import { memo, useState } from "react";
import { cx } from "../../components/ui/cx";
import { ContributorLabel } from "./ContributorLabel";

function Thumbnail({ file }: { file: InboxFile }) {
  const [failed, setFailed] = useState(false);
  if (!file.hasThumbnail || failed) {
    const Icon = file.mime.startsWith("image/") ? ImageIcon : Film;
    return (
      <div className="grid size-full place-items-center bg-surface-2 text-subtle">
        <Icon className="size-7" strokeWidth={1.6} />
      </div>
    );
  }
  return (
    <img
      src={`/api/me/files/${file.id}/thumbnail`}
      alt=""
      loading="lazy"
      decoding="async"
      className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
      onError={() => setFailed(true)}
    />
  );
}

type Props = {
  file: InboxFile;
  selecting: boolean;
  selected: boolean;
  onOpen: (file: InboxFile) => void;
  onToggle: (id: string) => void;
};

/** Memoised: the grid can hold hundreds of tiles and re-renders on every selection change. */
export const FileTile = memo(function FileTile({
  file,
  selecting,
  selected,
  onOpen,
  onToggle,
}: Props) {
  const isVideo = file.mime.startsWith("video/");
  return (
    <li className="animate-fade-up">
      <button
        type="button"
        onClick={() => (selecting ? onToggle(file.id) : onOpen(file))}
        aria-pressed={selecting ? selected : undefined}
        aria-label={`${isVideo ? "Video" : "Photo"} ${file.name} from ${file.contributorName ?? "unknown"}`}
        className={cx(
          "group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-surface-2 transition active:scale-[0.98] sm:rounded-3xl",
          selected && "ring-3 ring-hop-strong ring-offset-2 ring-offset-canvas",
        )}
      >
        <Thumbnail file={file} />
        <span className="absolute inset-x-0 bottom-0 flex bg-linear-to-t from-black/70 via-black/20 to-transparent px-2.5 pt-8 pb-2 text-left text-xs font-medium text-white sm:text-[13px]">
          <ContributorLabel file={file} />
        </span>
        {selecting && (
          <span
            className={cx(
              "absolute top-2 right-2 grid size-6 place-items-center rounded-full border-2 transition",
              selected ? "border-hop bg-hop text-ink" : "border-white/90 bg-black/20",
            )}
          >
            {selected && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        )}
      </button>
    </li>
  );
});
