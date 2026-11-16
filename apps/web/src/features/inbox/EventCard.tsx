import { colorFor, type HopSummary, type InboxFile } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Link2, Lock } from "lucide-react";
import { useState } from "react";
import { cx } from "../../components/ui/cx";
import { formatBytes } from "../../lib/format";
import { queries } from "../../lib/queries";

/** "12 clips · 48 MB". */
export function eventSummary(hop: HopSummary): string {
  const clips = hop.fileCount === 1 ? "1 clip" : `${hop.fileCount} clips`;
  return hop.fileCount === 0 ? "No clips yet" : `${clips} · ${formatBytes(hop.totalBytes)}`;
}

function Cover({ file }: { file: InboxFile }) {
  const [failed, setFailed] = useState(false);
  if (!file.hasThumbnail || failed) return <div className="size-full bg-surface-2" />;
  return (
    <img
      src={`/api/me/files/${file.id}/thumbnail`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover transition duration-500 group-hover:scale-[1.04]"
    />
  );
}

/** Up to three of the event's newest clips tiled as its cover, or Bobble when there are none. */
function Mosaic({ hop, color }: { hop: HopSummary; color: string }) {
  const cover = useQuery({ ...queries.cover(hop.id), enabled: hop.fileCount > 0 });
  const clips = cover.data ?? [];
  const { id, hex } = colorFor(color, "");

  if (hop.fileCount === 0 || (cover.isSuccess && clips.length === 0)) {
    return (
      <div
        className="grid size-full place-items-center"
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${hex} 55%, transparent), color-mix(in oklab, ${hex} 15%, transparent))`,
        }}
      >
        <img src={`/bobble/face-${id}.png`} alt="" className="-mt-8 h-[55%] object-contain" />
      </div>
    );
  }
  if (cover.isPending) return <div className="skeleton size-full" />;

  const [first, second, third] = clips;
  return (
    <div
      className={cx(
        "grid size-full gap-0.5",
        clips.length === 2 && "grid-cols-2",
        clips.length >= 3 && "grid-cols-[3fr_2fr] grid-rows-2",
      )}
    >
      {first && (
        <div className={cx("overflow-hidden", clips.length >= 3 && "row-span-2")}>
          <Cover file={first} />
        </div>
      )}
      {second && (
        <div className="overflow-hidden">
          <Cover file={second} />
        </div>
      )}
      {third && (
        <div className="overflow-hidden">
          <Cover file={third} />
        </div>
      )}
    </div>
  );
}

/**
 * One event, as the iPhone app's inbox shows it: its newest clips as a
 * cover, its name and how much is in it, and whether the athlete's link
 * uploads into it.
 */
export function EventCard({
  hop,
  color,
  live,
}: {
  hop: HopSummary;
  color: string;
  /** The athlete's link uploads into this event right now. */
  live: boolean;
}) {
  return (
    <Link
      to="/app/events/$hopId"
      params={{ hopId: hop.id }}
      className="group relative block h-60 overflow-hidden rounded-(--radius-card) bg-surface-2 shadow-soft transition duration-200 hover:shadow-lift active:scale-[0.985]"
    >
      <Mosaic hop={hop} color={color} />
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent from-35% to-black/75" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-5 text-white">
        {(live || hop.status === "closed") && (
          <div className="flex gap-1.5">
            {live && (
              <span className="badge border border-white/20 bg-[color-mix(in_oklab,var(--accent)_55%,transparent)] backdrop-blur-xl">
                <Link2 className="size-3.5" /> Your link
              </span>
            )}
            {hop.status === "closed" && (
              <span className="badge border border-white/20 bg-black/30 backdrop-blur-xl">
                <Lock className="size-3" /> Closed
              </span>
            )}
          </div>
        )}
        <h2 className="truncate text-2xl font-bold tracking-tight">{hop.title}</h2>
        <p className="text-sm text-white/85 tabular-nums">{eventSummary(hop)}</p>
      </div>
    </Link>
  );
}
