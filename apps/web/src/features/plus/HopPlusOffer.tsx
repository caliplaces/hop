import type { WebPrice } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { Infinity as Forever, HardDrive, type LucideIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { formatBytes } from "../../lib/format";
import { queries } from "../../lib/queries";
import { formatPrice, isPaymentDue, useCheckout, usePortal, yearlySaving } from "./billing";

function Perk({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <li className="flex items-center gap-3 text-[15px]">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft">
        <Icon className="size-4" />
      </span>
      {children}
    </li>
  );
}

function PriceOption({
  price,
  monthly,
  checked,
  onChange,
}: {
  price: WebPrice;
  monthly: WebPrice | undefined;
  checked: boolean;
  onChange: () => void;
}) {
  const yearly = price.interval === "year";
  const saving = yearly ? yearlySaving(monthly, price) : 0;
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition has-checked:border-fg has-checked:shadow-soft has-focus-visible:ring-2 has-focus-visible:ring-accent">
      <input
        type="radio"
        name="hop-plus-price"
        className="size-4 accent-fg"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{yearly ? "Yearly" : "Monthly"}</span>
        {yearly && (
          <span className="block text-sm text-muted">
            {formatPrice(price, Math.round(price.amount / 12))} a month
          </span>
        )}
      </span>
      {saving > 0 && <span className="badge bg-accent-soft text-fg">Save {saving}%</span>}
      <span className="font-semibold tabular-nums">
        {formatPrice(price)}
        <span className="font-normal text-muted">/{yearly ? "year" : "month"}</span>
      </span>
    </label>
  );
}

/**
 * Hop+ for sale on the website: what it gives, the prices from Stripe
 * (yearly picked first, when there is one), and the way to Checkout. Where
 * the website doesn't sell it, the iPhone app does.
 */
export function HopPlusOffer({ perks = false }: { perks?: boolean }) {
  const prices = useQuery(queries.prices());
  const plan = useQuery(queries.plan());
  const checkout = useCheckout();
  const portal = usePortal();
  const [chosen, setChosen] = useState<string | null>(null);

  if (prices.isPending) return <div className="skeleton h-32 rounded-2xl" />;
  if (prices.isError && !prices.data) {
    return (
      <p className="text-sm text-muted">
        Couldn’t load Hop+ prices.{" "}
        <button
          type="button"
          className="font-medium text-fg underline underline-offset-2"
          onClick={() => prices.refetch()}
        >
          Try again
        </button>
      </p>
    );
  }
  // Loaded, and none: the website doesn't sell Hop+ here.
  const list = prices.data ?? [];
  if (list.length === 0) {
    return <p className="text-sm text-muted">Get it in the Hop iPhone app.</p>;
  }
  const monthly = list.find((p) => p.interval === "month");
  const yearly = list.find((p) => p.interval === "year");
  const selected = list.find((p) => p.id === chosen) ?? yearly ?? monthly;
  const plusStorage = plan.data?.plans.plus.storageBytes;

  return (
    <div>
      {perks && (
        <ul className="mb-5 space-y-2.5">
          {plusStorage !== undefined && (
            <Perk icon={HardDrive}>{`${formatBytes(plusStorage)} of storage`}</Perk>
          )}
          <Perk icon={Forever}>Every clip kept for good</Perk>
          <Perk icon={Sparkles}>The Hop+ mark on your page</Perk>
        </ul>
      )}
      <fieldset className="space-y-2">
        <legend className="sr-only">How often to pay</legend>
        {list.map((price) => (
          <PriceOption
            key={price.id}
            price={price}
            monthly={monthly}
            checked={price.id === selected?.id}
            onChange={() => setChosen(price.id)}
          />
        ))}
      </fieldset>
      <Button
        className="mt-4 w-full"
        disabled={!selected || checkout.opening}
        onClick={() => selected && checkout.mutate(selected.id)}
      >
        {checkout.opening ? "Opening checkout…" : "Get Hop+"}
      </Button>
      {isPaymentDue(checkout.error) && (
        <div role="alert" className="mt-4 rounded-2xl bg-danger/10 p-4 text-sm">
          <p className="text-danger">{checkout.error?.message}</p>
          <Button
            size="sm"
            variant="soft"
            className="mt-3"
            disabled={portal.opening}
            onClick={() => portal.mutate()}
          >
            {portal.opening ? "Opening…" : "Update your card"}
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Renews automatically until you cancel, which you can do anytime from your account. Payments
        are handled by Stripe. By subscribing you agree to the{" "}
        <a className="underline underline-offset-2" href="/terms" target="_blank" rel="noreferrer">
          Terms
        </a>
        .
      </p>
    </div>
  );
}

/** The offer on its own, for the inbox's nudges. */
export function HopPlusDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Get Hop+"
      description="More room, and every clip kept for good."
    >
      <div className="mt-5">
        <HopPlusOffer perks />
      </div>
    </Dialog>
  );
}
