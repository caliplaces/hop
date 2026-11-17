import type { PlanStatus } from "@hop/shared";
import { ClockAlert, HardDrive } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button";
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

/**
 * `onGetPlus` opens the website's Hop+ offer; without it (where the website
 * doesn't sell Hop+), the nudge points to the iPhone app instead.
 */
type GetPlus = { onGetPlus?: () => void };

function Nudge({
  icon,
  title,
  children,
  onGetPlus,
}: GetPlus & { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="glass flex items-start gap-4 rounded-(--radius-card) p-4 sm:p-5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{children}</p>
      </div>
      {onGetPlus && (
        <Button size="sm" className="shrink-0 self-center" onClick={onGetPlus}>
          Get Hop+
        </Button>
      )}
    </div>
  );
}

/** Free-plan clips the athlete has been told are leaving, as the app's banner says it. */
export function ExpiryNudge({
  expiring,
  onGetPlus,
}: GetPlus & { expiring: NonNullable<PlanStatus["expiring"]> }) {
  const when = leavingWhen(expiring.on);
  const title =
    expiring.clips === 1 ? `1 clip leaves ${when}` : `${expiring.clips} clips leave ${when}`;
  return (
    <Nudge
      icon={<ClockAlert className="size-6 text-orange-500" />}
      title={title}
      onGetPlus={onGetPlus}
    >
      Download the ones you want, or get Hop+{onGetPlus ? "" : " in the Hop iPhone app"} to keep
      every clip for good.
    </Nudge>
  );
}

/** Storage nearly full on the free plan. */
export function StorageNudge({ status, onGetPlus }: GetPlus & { status: PlanStatus }) {
  return (
    <Nudge
      icon={<HardDrive className="size-6 text-muted" />}
      title="Your storage is nearly full"
      onGetPlus={onGetPlus}
    >
      You’re using {formatBytes(status.storage.usedBytes)} of{" "}
      {formatBytes(status.storage.limitBytes)}. Hop+{onGetPlus ? "" : " in the Hop iPhone app"}{" "}
      gives you {formatBytes(status.plans.plus.storageBytes)}.
    </Nudge>
  );
}

/** On the free plan, with at least 80% of its storage used: as the iPhone app, a word about Hop+. */
export function isNearlyFull(status: PlanStatus): boolean {
  return (
    status.plan === "free" &&
    status.storage.limitBytes > 0 &&
    status.storage.usedBytes / status.storage.limitBytes >= 0.8
  );
}
