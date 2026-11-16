import type { WebPrice } from "@hop/shared";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db";
import { subscriptions, type UserRow, users } from "../db/schema";
import type { Env } from "../env";

/**
 * Hop+ on the website: Stripe Checkout to subscribe, Stripe's customer
 * portal to change or cancel.
 *
 * Only Stripe's word counts, never the browser's. A webhook only says that
 * a subscription changed: it's then fetched from Stripe and stored as it is
 * now (syncSubscription). So a retried, repeated or out-of-order event can't
 * roll it back, and what's stored never rests on an event's own copy.
 *
 * The Stripe account sells other things too. Only subscriptions to
 * STRIPE_PRODUCT_ID count, and only for a customer Hop made for an athlete
 * (users.stripe_customer_id). Test mode counts locally and on staging, live
 * mode only in production, as with App Store sandbox purchases.
 */

/** Pinned, so Stripe's replies keep the shape this file reads. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * When a renewal payment fails, Stripe retries it (by default for two
 * weeks) while the subscription is past due. Hop+ carries on meanwhile, as
 * in the App Store's billing grace period, but for no longer than this.
 */
export const PAST_DUE_GRACE_MS = 16 * DAY_MS;
/** How old a webhook's signature may be, as Stripe's own libraries allow. */
const WEBHOOK_TOLERANCE_S = 5 * 60;

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly param?: string,
  ) {
    super(message);
  }
}

/** Whether the website sells Hop+ here: Stripe is set up. */
export function stripeEnabled(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRODUCT_ID);
}

/** Live mode in production; test mode everywhere else. */
export function liveMode(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}

type Param = string | number | boolean | undefined | Params | Param[];
type Params = { [key: string]: Param };

/** Form-encodes parameters the way Stripe reads them: nested keys in brackets. */
export function formEncode(params: Params): URLSearchParams {
  const out = new URLSearchParams();
  const add = (key: string, value: Param) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) add(`${key}[${i}]`, item);
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    } else out.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return out;
}

async function stripe<T>(
  env: Env,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Params,
): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe isn't set up");
  const query = params ? formEncode(params) : undefined;
  const response = await fetch(method === "GET" && query ? `${API}${path}?${query}` : API + path, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "stripe-version": STRIPE_API_VERSION,
      ...(method !== "GET" && query ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method !== "GET" && query ? query : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code?: string; message?: string; param?: string } }
    | null;
  if (!response.ok) {
    const error = data?.error;
    throw new StripeError(
      response.status,
      error?.code,
      error?.message ?? `Stripe answered ${response.status}`,
      error?.param,
    );
  }
  return data as T;
}

type StripePrice = {
  id: string;
  product: string;
  active: boolean;
  type: "recurring" | "one_time";
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
};

export type StripeSubscription = {
  id: string;
  object: "subscription";
  customer: string;
  livemode: boolean;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  ended_at: number | null;
  start_date: number;
  metadata: Record<string, string> | null;
  items: {
    data: { price: StripePrice; current_period_start?: number; current_period_end?: number }[];
  };
};

/** Ended for good: nothing to cancel, nothing more to bill. */
const ENDED = new Set<StripeSubscription["status"]>(["canceled", "incomplete_expired"]);

let priceCache: { productId: string; until: number; prices: WebPrice[] } | undefined;
const PRICE_CACHE_MS = 5 * 60 * 1000;

/** Forgets the cached prices, as after changing them in Stripe. For tests. */
export function clearPriceCache() {
  priceCache = undefined;
}

/**
 * The Hop+ prices on sale: the product's active prices that renew every
 * month or every year, the newest for each, monthly first. Cached for a few
 * minutes, so showing them doesn't ask Stripe every time.
 */
export async function hopPlusPrices(env: Env, now = Date.now()): Promise<WebPrice[]> {
  const productId = env.STRIPE_PRODUCT_ID;
  if (priceCache?.productId === productId && now < priceCache.until) return priceCache.prices;
  // Newest first, as Stripe lists them.
  const list = await stripe<{ data: StripePrice[] }>(env, "GET", "/prices", {
    product: productId,
    active: true,
    type: "recurring",
    limit: 100,
  });
  const byInterval = new Map<WebPrice["interval"], WebPrice>();
  for (const price of list.data) {
    const interval = price.recurring?.interval;
    if (
      price.product !== productId ||
      !price.active ||
      price.type !== "recurring" ||
      typeof price.unit_amount !== "number" ||
      price.recurring?.interval_count !== 1 ||
      (interval !== "month" && interval !== "year") ||
      byInterval.has(interval)
    ) {
      continue;
    }
    byInterval.set(interval, {
      id: price.id,
      amount: price.unit_amount,
      currency: price.currency,
      interval,
    });
  }
  const prices = (["month", "year"] as const).flatMap((i) => byInterval.get(i) ?? []);
  priceCache = { productId, until: now + PRICE_CACHE_MS, prices };
  return prices;
}

/** Whether a subscription is to Hop+, rather than something else the account sells. */
export function isHopPlus(env: Env, subscription: StripeSubscription): boolean {
  const items = subscription.items?.data ?? [];
  return items.length > 0 && items.every((item) => item.price?.product === env.STRIPE_PRODUCT_ID);
}

/**
 * The athlete's Stripe customer, made the first time they check out. If two
 * checkouts race, one customer sticks and the other is left unused.
 */
export async function customerFor(env: Env, db: Db, user: UserRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe<{ id: string }>(env, "POST", "/customers", {
    // For receipts. An address the athlete never confirmed may not be theirs.
    email: user.emailVerified && user.email ? user.email : undefined,
    metadata: { hop_user_id: user.id },
  });
  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: Date.now() })
    .where(and(eq(users.id, user.id), isNull(users.stripeCustomerId), isNull(users.deletedAt)));
  const row = await db
    .select({ customer: users.stripeCustomerId })
    .from(users)
    .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
    .get();
  if (!row?.customer) throw new Error("Stripe customer wasn't stored");
  return row.customer;
}

/** Forgets a customer Stripe no longer has (deleted in its dashboard), so a new one is made. */
export async function forgetCustomer(db: Db, userId: string, customer: string): Promise<void> {
  await db
    .update(users)
    .set({ stripeCustomerId: null, updatedAt: Date.now() })
    .where(and(eq(users.id, userId), eq(users.stripeCustomerId, customer)));
}

/** Whether Stripe refused a call because the customer it names is gone. */
export function isMissingCustomer(error: unknown): boolean {
  return (
    error instanceof StripeError && error.code === "resource_missing" && error.param === "customer"
  );
}

/**
 * Expires the customer's open checkouts, so only the newest one can be paid:
 * two tabs mustn't make two subscriptions. One completing meanwhile can't
 * be expired, and is left to finish.
 */
async function expireOpenCheckouts(env: Env, customer: string): Promise<void> {
  const open = await stripe<{ data: { id: string }[] }>(env, "GET", "/checkout/sessions", {
    customer,
    status: "open",
    limit: 100,
  });
  for (const session of open.data) {
    try {
      await stripe(env, "POST", `/checkout/sessions/${encodeURIComponent(session.id)}/expire`);
    } catch (error) {
      if (!(error instanceof StripeError && error.status === 400)) throw error;
    }
  }
}

/** A Stripe Checkout page for a Hop+ price, for the athlete's customer. */
export async function startCheckout(
  env: Env,
  customer: string,
  userId: string,
  priceId: string,
): Promise<string> {
  await expireOpenCheckouts(env, customer);
  const session = await stripe<{ url: string | null }>(env, "POST", "/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { hop_user_id: userId },
    // On the subscription too: if the account is deleted while this is
    // open, the subscription it makes can still be traced and cancelled.
    subscription_data: { metadata: { hop_user_id: userId } },
    success_url: `${env.APP_URL}/app/my-hop?hopplus=welcome`,
    cancel_url: `${env.APP_URL}/app/my-hop`,
    custom_text: {
      submit: {
        message:
          "Hop+ renews automatically until you cancel. You can cancel anytime in your account on onmyhop.com.",
      },
    },
  });
  if (!session.url) throw new Error("Stripe made a checkout without a page");
  return session.url;
}

/** A page in Stripe's customer portal: payment method, invoices, cancelling. */
export async function portalUrl(env: Env, customer: string): Promise<string> {
  const session = await stripe<{ url: string }>(env, "POST", "/billing_portal/sessions", {
    customer,
    return_url: `${env.APP_URL}/app/my-hop`,
  });
  return session.url;
}

/** The customer's subscriptions that haven't ended, newest first. */
async function liveSubscriptions(env: Env, customer: string): Promise<StripeSubscription[]> {
  // Stripe lists every status but "canceled" unless asked.
  const list = await stripe<{ data: StripeSubscription[] }>(env, "GET", "/subscriptions", {
    customer,
    limit: 100,
  });
  return list.data.filter((s) => !ENDED.has(s.status));
}

/**
 * Stores the customer's Hop+ subscriptions as Stripe has them now: after a
 * checkout, in case its webhook is slow, and before another one, so nobody
 * pays twice.
 */
export async function refreshCustomer(env: Env, db: Db, customer: string): Promise<void> {
  const fetchedAt = Date.now();
  for (const subscription of await liveSubscriptions(env, customer)) {
    await syncSubscription(env, db, subscription, fetchedAt);
  }
}

/**
 * Ends the customer's Hop+ at once, as their account is deleted: nothing
 * else would stop Stripe billing them. Open checkouts go first, so none can
 * start another subscription. Throws if Stripe can't be reached, so the
 * account isn't deleted while it would still be billed.
 */
export async function cancelForDeletion(env: Env, customer: string): Promise<void> {
  await expireOpenCheckouts(env, customer);
  for (const subscription of await liveSubscriptions(env, customer)) {
    if (isHopPlus(env, subscription)) await cancel(env, subscription.id);
  }
}

async function cancel(env: Env, subscriptionId: string): Promise<void> {
  await stripe(env, "DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/** What a Stripe subscription gives, in the terms Hop stores. */
type Terms = { expiresAt: number; graceExpiresAt: number | null; autoRenew: boolean };

/**
 * When Hop+ ends under a Stripe subscription: the paid period's end. Null
 * for one that was never paid (its first payment failed or is pending),
 * which is never stored: no row, so it can't count as a Hop+ that lapsed.
 */
export function stripeTerms(subscription: StripeSubscription): Terms | null {
  const item = subscription.items.data[0];
  const start = (item?.current_period_start ?? Number.NaN) * 1000;
  const end = (item?.current_period_end ?? Number.NaN) * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`Stripe subscription ${subscription.id} has no billing period`);
  }
  const autoRenew = !subscription.cancel_at_period_end && subscription.cancel_at === null;
  switch (subscription.status) {
    case "active":
    case "trialing":
      return { expiresAt: end, graceExpiresAt: null, autoRenew };
    case "past_due":
      // The period started unpaid, and Stripe is retrying the payment.
      return {
        expiresAt: start,
        graceExpiresAt: Math.min(end, start + PAST_DUE_GRACE_MS),
        autoRenew,
      };
    case "canceled": {
      const ended = (subscription.ended_at ?? Number.NaN) * 1000;
      return {
        expiresAt: Number.isFinite(ended) ? Math.min(ended, end) : start,
        graceExpiresAt: null,
        autoRenew: false,
      };
    }
    // Retries ran out, or a trial ended unpaid: the period was never paid.
    case "unpaid":
    case "paused":
      return { expiresAt: start, graceExpiresAt: null, autoRenew: false };
    case "incomplete":
    case "incomplete_expired":
      return null;
    default:
      throw new Error(`Stripe subscription ${subscription.id} is ${String(subscription.status)}`);
  }
}

export type SyncResult =
  | "stored"
  | "not_hop_plus"
  | "wrong_mode"
  | "never_paid"
  | "no_account"
  | "cancelled";

/**
 * Stores a subscription as Stripe gave it at `fetchedAt` (taken before
 * asking). Data fetched earlier never overwrites data fetched later.
 */
export async function syncSubscription(
  env: Env,
  db: Db,
  subscription: StripeSubscription,
  fetchedAt: number,
): Promise<SyncResult> {
  if (!isHopPlus(env, subscription)) return "not_hop_plus";
  if (subscription.livemode !== liveMode(env)) return "wrong_mode";
  const owner =
    typeof subscription.customer === "string"
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.stripeCustomerId, subscription.customer), isNull(users.deletedAt)))
          .get()
      : undefined;
  if (!owner) {
    // A checkout left open when its account was deleted, and paid after:
    // nobody has Hop+ from it, so it mustn't go on billing.
    const userId = subscription.metadata?.hop_user_id;
    const deleted = userId
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt)))
          .get()
      : undefined;
    if (deleted && !ENDED.has(subscription.status)) {
      await cancel(env, subscription.id);
      console.warn("stripe: cancelled a deleted account's subscription", subscription.id);
      return "cancelled";
    }
    console.warn("stripe: subscription no account has", subscription.id);
    return "no_account";
  }

  const terms = stripeTerms(subscription);
  if (!terms) return "never_paid";
  const interval = subscription.items.data[0]?.price.recurring?.interval;
  const productId = interval === "year" ? "hop_plus_annual" : "hop_plus";
  const now = Date.now();
  const revise = db
    .update(users)
    .set({ planRevision: sql`${users.planRevision} + 1` })
    .where(eq(users.id, owner.id));
  const upsert = db
    .insert(subscriptions)
    .values({
      originalTransactionId: subscription.id,
      userId: owner.id,
      provider: "stripe",
      productId,
      environment: subscription.livemode ? "Production" : "Sandbox",
      ...terms,
      purchasedAt: subscription.start_date * 1000,
      signedAt: fetchedAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.originalTransactionId,
      set: { productId, ...terms, signedAt: fetchedAt, updatedAt: now },
      setWhere: and(
        eq(subscriptions.provider, "stripe"),
        eq(subscriptions.userId, owner.id),
        lte(subscriptions.signedAt, fetchedAt),
      ),
    });
  await db.batch([revise, upsert]);
  return "stored";
}

/** Fetches a subscription from Stripe and stores it. A subscription Stripe doesn't have is skipped. */
export async function syncById(env: Env, db: Db, subscriptionId: string): Promise<SyncResult> {
  const fetchedAt = Date.now();
  let subscription: StripeSubscription;
  try {
    subscription = await stripe<StripeSubscription>(
      env,
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  } catch (error) {
    if (error instanceof StripeError && error.code === "resource_missing") return "no_account";
    throw error;
  }
  return syncSubscription(env, db, subscription, fetchedAt);
}

const encoder = new TextEncoder();

function hexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Whether a webhook is Stripe's: its Stripe-Signature header has an HMAC
 * (v1) of the timestamp and the body as received, made with the endpoint's
 * signing secret, and the timestamp is recent, so it can't be replayed later.
 */
export async function verifyWebhook(
  secret: string,
  header: string | undefined,
  body: Uint8Array,
  now = Date.now(),
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = Number.NaN;
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1") {
      const bytes = hexBytes(value);
      if (bytes) signatures.push(bytes);
    }
  }
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > WEBHOOK_TOLERANCE_S) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const prefix = encoder.encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  for (const signature of signatures) {
    if (await crypto.subtle.verify("HMAC", key, signature, signed)) return true;
  }
  return false;
}

type StripeEvent = {
  type?: unknown;
  livemode?: unknown;
  data?: { object?: Record<string, unknown> };
};

/** The subscription a webhook event is about, if it's one Hop listens for. */
export function subscriptionOf(event: StripeEvent): string | null {
  const object = event.data?.object ?? {};
  const type = typeof event.type === "string" ? event.type : "";
  let id: unknown;
  if (type.startsWith("customer.subscription.")) id = object.id;
  else if (
    type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded"
  ) {
    id = object.mode === "subscription" ? object.subscription : null;
  } else if (type.startsWith("invoice.")) {
    const parent = object.parent as
      | { subscription_details?: { subscription?: unknown } | null }
      | null
      | undefined;
    // Where the endpoint's API version keeps it: newer ones under parent.
    id = parent?.subscription_details?.subscription ?? object.subscription;
  }
  return typeof id === "string" && id.startsWith("sub_") ? id : null;
}
