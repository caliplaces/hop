import type { PlanStatus } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CreditCard } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatBytes } from "../../lib/format";
import { queries } from "../../lib/queries";
import { billingGraceEnds, formatDay, usePortal } from "../plus/billing";
import { HopPlusOffer } from "../plus/HopPlusOffer";

/** What happens next with Hop+, and where it's managed. */
function Subscription({ subscription }: { subscription: NonNullable<PlanStatus["subscription"]> }) {
  const portal = usePortal();
  const grace = billingGraceEnds(subscription);
  const web = subscription.provider === "stripe";

  return (
    <div className="mt-4 border-t border-line pt-4">
      {grace ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {web
            ? `Your last payment didn’t go through. Update your card by ${formatDay(grace)} to keep Hop+.`
            : `Apple couldn’t take your last payment. Update it in your Apple Account by ${formatDay(grace)} to keep Hop+.`}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {subscription.autoRenew
            ? `Renews on ${formatDay(subscription.expiresAt)}.`
            : `Ends on ${formatDay(subscription.expiresAt)}, and won’t renew.`}
        </p>
      )}
      {web ? (
        <Button
          variant="soft"
          size="sm"
          className="mt-3"
          disabled={portal.opening}
          onClick={() => portal.mutate()}
        >
          <CreditCard className="size-4" />
          {portal.opening ? "Opening…" : "Manage subscription"}
        </Button>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Billed through the App Store: manage it in your Apple Account’s subscriptions.
        </p>
      )}
    </div>
  );
}

/**
 * The athlete's plan, as the app's Account shows it: which one, how much of
 * its storage is used, and how long clips are kept. On the free plan, Hop+
 * for sale; with Hop+, when it renews and where to manage it.
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
        aria-valuenow={Math.round(used * 100)}
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
      </p>

      {plus && status.subscription && <Subscription subscription={status.subscription} />}
      {!plus && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-3 text-sm">
            <span className="font-semibold">Hop+</span>
            <span className="text-muted">
              {" "}
              gives you {formatBytes(status.plans.plus.storageBytes)} and keeps every clip for good.
            </span>
          </p>
          <HopPlusOffer />
        </div>
      )}
    </div>
  );
}
