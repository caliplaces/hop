import type { BillingRedirect, PlanStatus, WebPrice } from "@hop/shared";
import { useMutation } from "@tanstack/react-query";
import { useFeedback } from "../../components/ui/feedback";
import { ApiError, api } from "../../lib/api";

/**
 * A price as people read it: "€4.99". Stripe gives amounts in the
 * currency's smallest unit, so cents for euros.
 */
export function formatPrice(price: Pick<WebPrice, "amount" | "currency">, amount = price.amount) {
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

/** How much a year costs less than twelve months, in whole percent; 0 when it doesn't. */
export function yearlySaving(monthly: WebPrice | undefined, yearly: WebPrice | undefined): number {
  if (!monthly || !yearly || monthly.currency !== yearly.currency) return 0;
  const twelve = monthly.amount * 12;
  return twelve > yearly.amount ? Math.floor(((twelve - yearly.amount) / twelve) * 100) : 0;
}

/** The day a date falls on, as people read it: "16 December 2026". */
export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(ms);
}

/**
 * While a failed renewal is retried: the period has ended, and Hop+ lasts
 * until the returned time unless the payment goes through.
 */
export function billingGraceEnds(
  subscription: PlanStatus["subscription"],
  now = Date.now(),
): number | null {
  const grace = subscription?.graceExpiresAt;
  if (!subscription || !grace) return null;
  return subscription.expiresAt <= now && now < grace ? grace : null;
}

/**
 * Whether the plan card links Stripe's billing page on its own: for whoever
 * has had Hop+ from the website (past invoices, an overdue card), unless
 * they have it now, when its subscription links the page already.
 */
export function showsBillingLink(
  status: Pick<PlanStatus, "plan" | "subscription" | "webBilling">,
): boolean {
  const webPlus = status.plan === "plus" && status.subscription?.provider === "stripe";
  return status.webBilling === true && !webPlus;
}

/** Stripe's own pages: the only places these redirects go. */
const STRIPE_HOSTS = new Set(["checkout.stripe.com", "billing.stripe.com"]);

export function isStripePage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && STRIPE_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** Checkout refused: a subscription is still billing but behind, and the portal fixes it. */
export const isPaymentDue = (error: unknown) =>
  error instanceof ApiError && error.code === "payment_due";

/**
 * Sends the browser to a Stripe page the API makes: Checkout for a price,
 * or the customer portal. It stays pending while the page leaves. Errors
 * are toasts, except those the page shows itself (`shown`).
 */
function useStripeRedirect<T>(
  path: string,
  body: (input: T) => unknown,
  shown: (error: unknown) => boolean = () => false,
) {
  const { toast } = useFeedback();
  const mutation = useMutation({
    mutationFn: async (input: T) => {
      const { url } = await api<BillingRedirect>(path, { method: "POST", json: body(input) });
      if (!isStripePage(url)) throw new Error(`Not a Stripe page: ${url}`);
      return url;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => {
      if (shown(error)) return;
      toast(
        error instanceof ApiError
          ? error.message
          : "Couldn’t reach Hop. Check your connection and try again.",
        "error",
      );
    },
  });
  return { ...mutation, opening: mutation.isPending || mutation.isSuccess };
}

/** Starts Stripe Checkout for one of the website's Hop+ prices. */
export const useCheckout = () =>
  useStripeRedirect<string>("/billing/web/checkout", (priceId) => ({ priceId }), isPaymentDue);

/** Opens Stripe's customer portal: payment method, invoices, cancelling. */
export const usePortal = () => useStripeRedirect<void>("/billing/web/portal", () => ({}));
