import { type BillingRedirect, type WebPrice, webCheckoutSchema } from "@hop/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../db";
import type { AppEnv } from "../env";
import { fail } from "../lib/http";
import { activeSubscription } from "../lib/plans";
import { currentUser, requireUser } from "../lib/session";
import {
  customerFor,
  forgetCustomer,
  hopPlusPrices,
  isMissingCustomer,
  liveMode,
  portalUrl,
  refreshCustomer,
  StripeError,
  startCheckout,
  stripeEnabled,
  subscriptionOf,
  syncById,
  verifyWebhook,
} from "../lib/stripe";
import { validate } from "../lib/validate";
import { planStatus } from "./billing";

/**
 * Hop+ on the website, through Stripe (see lib/stripe.ts). The website asks
 * for a Checkout or portal page and sends the browser there; the plan
 * changes when Stripe's webhook says so, and is read back from Stripe.
 */

/** Each call reaches Stripe, so an account gets a few a minute. */
async function tooManyCalls(c: Context<AppEnv>, userId: string): Promise<boolean> {
  const { success } = await c.env.PROFILE_LIMITER.limit({ key: `billing:${userId}` });
  return !success;
}

const unavailable = (c: Context<AppEnv>) =>
  fail(c, 503, "billing_unavailable", "Hop+ can't be bought on the website just now.");

const stripeDown = (c: Context<AppEnv>, error: unknown) => {
  console.error("stripe: call failed", error instanceof StripeError ? error.code : error);
  return fail(c, 502, "billing_failed", "Couldn't reach our payment provider. Try again.");
};

/** Stripe's events are a few KiB; refuse much bigger bodies before reading them. */
const limitWebhookBody = bodyLimit({
  maxSize: 512 * 1024,
  onError: (c) => fail(c, 413, "too_large"),
});

const decoder = new TextDecoder();

export const stripeRoutes = new Hono<AppEnv>()
  /** The Hop+ prices on sale on the website; none where Stripe isn't set up. */
  .get("/billing/web/prices", requireUser, async (c) => {
    if (!stripeEnabled(c.env)) return c.json({ prices: [] as WebPrice[] });
    try {
      return c.json({ prices: await hopPlusPrices(c.env) });
    } catch (error) {
      return stripeDown(c, error);
    }
  })

  /** A Stripe Checkout page for Hop+ at one of those prices. */
  .post("/billing/web/checkout", requireUser, validate("json", webCheckoutSchema), async (c) => {
    if (!stripeEnabled(c.env)) return unavailable(c);
    const user = currentUser(c);
    if (await tooManyCalls(c, user.id)) {
      return fail(c, 429, "rate_limited", "Too many tries. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const { priceId } = c.req.valid("json");
    try {
      if (!(await hopPlusPrices(c.env)).some((price) => price.id === priceId)) {
        return fail(c, 400, "unknown_price", "That price isn't on sale. Reload and try again.");
      }
      // Catch up with Stripe first: a checkout paid moments ago may not have
      // reached us yet, and nobody should pay for Hop+ twice.
      if (user.stripeCustomerId) await refreshCustomer(c.env, db, user.stripeCustomerId);
      if (await activeSubscription(db, user.id)) {
        return fail(c, 409, "already_plus", "You already have Hop+.");
      }
      let customer = await customerFor(c.env, db, user);
      try {
        return c.json<BillingRedirect>({
          url: await startCheckout(c.env, customer, user.id, priceId),
        });
      } catch (error) {
        if (!isMissingCustomer(error)) throw error;
        // Deleted in Stripe's dashboard: start again with a new customer.
        await forgetCustomer(db, user.id, customer);
        customer = await customerFor(c.env, db, { ...user, stripeCustomerId: null });
        return c.json<BillingRedirect>({
          url: await startCheckout(c.env, customer, user.id, priceId),
        });
      }
    } catch (error) {
      return stripeDown(c, error);
    }
  })

  /** Stripe's customer portal: payment method, invoices, cancelling. */
  .post("/billing/web/portal", requireUser, async (c) => {
    if (!stripeEnabled(c.env)) return unavailable(c);
    const user = currentUser(c);
    if (!user.stripeCustomerId) {
      return fail(c, 404, "no_customer", "You haven't bought anything on the website.");
    }
    if (await tooManyCalls(c, user.id)) {
      return fail(c, 429, "rate_limited", "Too many tries. Try again in a minute.");
    }
    try {
      return c.json<BillingRedirect>({ url: await portalUrl(c.env, user.stripeCustomerId) });
    } catch (error) {
      return stripeDown(c, error);
    }
  })

  /**
   * Reads the athlete's subscriptions from Stripe now, rather than waiting
   * for its webhook: back from Checkout or the portal. Returns the plan.
   */
  .post("/billing/web/sync", requireUser, async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    if (stripeEnabled(c.env) && user.stripeCustomerId) {
      if (await tooManyCalls(c, user.id)) {
        return fail(c, 429, "rate_limited", "Too many tries. Try again in a minute.");
      }
      try {
        await refreshCustomer(c.env, db, user.stripeCustomerId);
      } catch (error) {
        return stripeDown(c, error);
      }
    }
    return c.json(await planStatus(db, user));
  })

  /**
   * Stripe's webhook, set in its dashboard for this site's environment. Only
   * says which subscription changed; it's then read from Stripe. Anything
   * but a 2xx is retried, so events Hop has no use for still get a 200.
   */
  .post("/stripe/webhook", limitWebhookBody, async (c) => {
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !stripeEnabled(c.env)) return fail(c, 404, "not_found");
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (!(await verifyWebhook(secret, c.req.header("stripe-signature"), body))) {
      return fail(c, 400, "invalid_signature");
    }
    let event: Parameters<typeof subscriptionOf>[0];
    try {
      event = JSON.parse(decoder.decode(body));
    } catch {
      return fail(c, 400, "invalid_event");
    }
    // A live event on staging, or a test one in production: a misconfigured endpoint.
    if (event?.livemode !== liveMode(c.env)) return fail(c, 400, "wrong_mode");
    const subscriptionId = subscriptionOf(event);
    if (subscriptionId) {
      // A failure answers 500, and Stripe tries again later.
      const result = await syncById(c.env, getDb(c.env.DB), subscriptionId);
      if (result === "stored") {
        console.log("stripe: synced", event.type, subscriptionId);
      }
    }
    return c.json({ received: true });
  });
