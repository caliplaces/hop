import type { PlanStatus } from "@hop/shared";
import { ClockAlert, HardDrive } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytes } from "../../lib/format";

/**
 * The day free-plan clips leave, from the API's calendar date (always
 * Gregorian, YYYY-MM-DD), in words for where the athlete is: "today",
 * "tomorrow" or "on 20 November". A day already past here is "today": the
 * clips stay until it has ended everywhere.
 */
export function leavingWhen(on: string, now = new Date()): string {
  const [year, month, day] = on.split("-").map(Number);
  if (!year || !month || !day) return "soon";
  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date <= today) return "today";
  if (date.getTime() === tomorrow.getTime()) return "tomorrow";
  return `on ${date.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

function Nudge({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="glass flex items-start gap-4 rounded-(--radius-card) p-4 sm:p-5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{children}</p>
      </div>
    </div>
  );
}

/** Free-plan clips the athlete has been told are leaving, as the app's banner says it. */
export function ExpiryNudge({ expiring }: { expiring: NonNullable<PlanStatus["expiring"]> }) {
  const when = leavingWhen(expiring.on);
  const title =
    expiring.clips === 1 ? `1 clip leaves ${when}` : `${expiring.clips} clips leave ${when}`;
  return (
    <Nudge icon={<ClockAlert className="size-6 text-orange-500" />} title={title}>
      Download the ones you want, or get Hop+ in the Hop iPhone app to keep every clip for good.
    </Nudge>
  );
}

/** Storage nearly full on the free plan. */
export function StorageNudge({ status }: { status: PlanStatus }) {
  return (
    <Nudge icon={<HardDrive className="size-6 text-muted" />} title="Your storage is nearly full">
      You’re using {formatBytes(status.storage.usedBytes)} of{" "}
      {formatBytes(status.storage.limitBytes)}. Hop+ in the Hop iPhone app gives you{" "}
      {formatBytes(status.plans.plus.storageBytes)}.
    </Nudge>
  );
}

/** At least 80% of the plan's storage used. */
export function isNearlyFull(status: PlanStatus): boolean {
  return (
    status.storage.limitBytes > 0 && status.storage.usedBytes / status.storage.limitBytes >= 0.8
  );
}
