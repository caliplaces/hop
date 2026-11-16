import { useQuery } from "@tanstack/react-query";
import { formatBytes } from "../../lib/format";
import { queries } from "../../lib/queries";

/**
 * The athlete's plan, as the app's Account shows it: which one, how much of
 * its storage is used, and how long clips are kept. Hop+ is bought in the
 * iPhone app.
 */
export function PlanCard() {
  const plan = useQuery(queries.plan());
  if (plan.isPending) return <div className="skeleton h-32 rounded-3xl" />;
  if (!plan.data) return null;
  const status = plan.data;
  const used =
    status.storage.limitBytes > 0 ? status.storage.usedBytes / status.storage.limitBytes : 0;
  const plus = status.plan === "plus";

  return (
    <div className="rounded-3xl bg-surface-2 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-lg font-bold tracking-tight">{plus ? "Hop+" : "Free"}</p>
        <p className="text-sm text-muted tabular-nums">
          {formatBytes(status.storage.usedBytes)} of {formatBytes(status.storage.limitBytes)}
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-line-strong"
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.max(0, Math.round(used * 100)))}
        aria-valuetext={`${formatBytes(status.storage.usedBytes)} of ${formatBytes(status.storage.limitBytes)}`}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${Math.min(100, Math.max(used > 0 ? 2 : 0, used * 100))}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-muted">
        {status.retentionDays === null
          ? "Clips are kept for good."
          : `Clips are kept ${status.retentionDays} days.`}
        {!plus && " Hop+, in the Hop iPhone app, keeps every clip and gives you more room."}
      </p>
    </div>
  );
}
