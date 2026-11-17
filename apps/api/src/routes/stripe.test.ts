import type { BillingRedirect, PlanStatus, WebPrice } from "@hop/shared";
import { PLANS } from "@hop/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { sessions, subscriptions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { randomToken, sha256Hex } from "../lib/crypto";
import { storageLimitSql } from "../lib/plans";
import {
  checkoutDeadline,
  clearPriceCache,
  formEncode,
  hopPlusPrices,
  PAST_DUE_GRACE_MS,
  STRIPE_API_VERSION,
  type StripeSubscription,
  startCheckout,
  stripeTerms,
  syncSubscription,
} from "../lib/stripe";
import { createTestD1 } from "../test/d1";

const DAY = 24 * 60 * 60 * 1000;
const PRODUCT = "prod_hopplus";
const WHSEC = "whsec_test_secret";
const MONTHLY = "price_monthly";
const ANNUAL = "price_annual";

let env: Env;
let db: ReturnType<typeof getDb>;
let session: string;
let limited: boolean;
let pending: Promise<unknown>[];

type Call = { method: string; path: string; params: URLSearchParams; headers: Headers };
type FakeSession = { id: string; customer: string; status: "open" | "complete" | "expired" };

/** Just enough of Stripe's API for these routes, in memory. */
let fake: {
  prices: Record<string, unknown>[];
  customers: Set<string>;
  subscriptions: Map<string, StripeSubscription>;
  sessions: FakeSession[];
  calls: Call[];
  down: boolean;
};
let nextId = 0;

const nowS = () => Math.floor(Date.now() / 1000);

function price(id: string, interval: string, product = PRODUCT, extra = {}) {
  return {
    id,
    object: "price",
    product,
    active: true,
    type: "recurring",
    unit_amount: interval === "year" ? 4900 : 499,
    currency: "eur",
    recurring: { interval, interval_count: 1 },
    ...extra,
  };
}

function subscription(
  overrides: Partial<StripeSubscription> & { interval?: "month" | "year"; product?: string } = {},
): StripeSubscription {
  const { interval = "month", product = PRODUCT, ...rest } = overrides;
  return {
    id: "sub_alex",
    object: "subscription",
    customer: "cus_alex",
    livemode: true,
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    ended_at: null,
    start_date: nowS() - 60,
    metadata: { hop_user_id: "usr_a" },
    items: {
      data: [
        {
          price: price(interval === "year" ? ANNUAL : MONTHLY, interval, product) as never,
          current_period_start: nowS() - 60,
          current_period_end: nowS() + 30 * 86400,
        },
      ],
    },
    ...rest,
  };
}

const list = (data: unknown[]) => Response.json({ object: "list", data, has_more: false });
const missing = (param?: string) =>
  Response.json(
    {
      error: { type: "invalid_request_error", code: "resource_missing", message: "No such", param },
    },
    { status: param ? 400 : 404 },
  );

async function stripeApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin !== "https://api.stripe.com") throw new Error(`Unexpected fetch: ${url}`);
  const method = init?.method ?? "GET";
  const params =
    method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
  const path = url.pathname.replace(/^\/v1/, "");
  fake.calls.push({ method, path, params, headers: new Headers(init?.headers) });
  if (fake.down) return Response.json({ error: { message: "Down" } }, { status: 500 });

  if (method === "GET" && path === "/prices") {
    return list(fake.prices.filter((p) => p.product === params.get("product")));
  }
  if (method === "POST" && path === "/customers") {
    const id = `cus_${++nextId}`;
    fake.customers.add(id);
    return Response.json({ id, object: "customer" });
  }
  // As Stripe answers for a customer it doesn't have (or deleted).
  const customerParam = params.get("customer");
  if (customerParam !== null && path !== "/customers" && !fake.customers.has(customerParam)) {
    return missing("customer");
  }
  if (method === "GET" && path === "/checkout/sessions") {
    return list(
      fake.sessions.filter(
        (s) => s.customer === params.get("customer") && s.status === params.get("status"),
      ),
    );
  }
  const expire = path.match(/^\/checkout\/sessions\/([^/]+)\/expire$/);
  if (method === "POST" && expire) {
    const found = fake.sessions.find((s) => s.id === expire[1]);
    if (found?.status !== "open") {
      return Response.json({ error: { message: "Not open" } }, { status: 400 });
    }
    found.status = "expired";
    return Response.json(found);
  }
  if (method === "POST" && path === "/checkout/sessions") {
    const customer = params.get("customer") ?? "";
    const id = `cs_test_${++nextId}`;
    fake.sessions.push({ id, customer, status: "open" });
    return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  if (method === "POST" && path === "/billing_portal/sessions") {
    return Response.json({ url: "https://billing.stripe.com/p/session/test_1" });
  }
  if (method === "GET" && path === "/subscriptions") {
    // Every status but "canceled", unless asked for all.
    const all = params.get("status") === "all";
    return list(
      [...fake.subscriptions.values()].filter(
        (s) => s.customer === params.get("customer") && (all || s.status !== "canceled"),
      ),
    );
  }
  const one = path.match(/^\/subscriptions\/([^/]+)$/);
  if (one) {
    const found = fake.subscriptions.get(decodeURIComponent(one[1] ?? ""));
    if (!found) return missing();
    if (method === "DELETE") {
      found.status = "canceled";
      found.ended_at = nowS();
    }
    return Response.json(found);
  }
  throw new Error(`Unexpected Stripe call: ${method} ${path}`);
}

beforeEach(async () => {
  const DB = createTestD1();
  limited = false;
  pending = [];
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRODUCT_ID: PRODUCT,
    BILLING_LIMITER: { limit: async () => ({ success: !limited }) },
  } as unknown as Env;
  db = getDb(DB);
  fake = {
    prices: [price(MONTHLY, "month"), price(ANNUAL, "year")],
    customers: new Set(["cus_alex"]),
    subscriptions: new Map(),
    sessions: [],
    calls: [],
    down: false,
  };
  clearPriceCache();
  vi.stubGlobal("fetch", vi.fn(stripeApi));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  const now = Date.now();
  await db.insert(users).values([
    {
      id: "usr_a",
      oidcSub: "sub-a",
      handle: "alex",
      email: "alex@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    { id: "usr_b", oidcSub: "sub-b", handle: "blake", createdAt: now, updatedAt: now },
  ]);
  session = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(session),
    userId: "usr_a",
    kind: "web",
    createdAt: now,
    expiresAt: now + DAY,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function call(path: string, init: RequestInit = {}, auth = true) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: {
        ...(auth ? { cookie: `hop_session=${session}` } : {}),
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    }),
    env,
    {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  );
}

const checkout = (priceId = MONTHLY) =>
  call("/billing/web/checkout", { method: "POST", body: JSON.stringify({ priceId }) });
const plan = async () => (await (await call("/me/plan")).json()) as PlanStatus;
const alex = () => db.select().from(users).where(eq(users.id, "usr_a")).get();
const linkAlex = (customer = "cus_alex") =>
  db.update(users).set({ stripeCustomerId: customer }).where(eq(users.id, "usr_a"));
const stripeCalls = () => fake.calls.map((c) => `${c.method} ${c.path}`);

const encoder = new TextEncoder();
async function signature(body: string, secret = WHSEC, t = nowS()) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${body}`)));
  return `t=${t},v1=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function webhook(
  type: string,
  object: Record<string, unknown>,
  {
    header,
    livemode = true,
  }: { header?: (body: string) => Promise<string>; livemode?: boolean } = {},
) {
  const body = JSON.stringify({
    id: `evt_${++nextId}`,
    object: "event",
    type,
    livemode,
    data: { object },
  });
  return call(
    "/stripe/webhook",
    {
      method: "POST",
      body,
      headers: { "stripe-signature": await (header ?? signature)(body) },
    },
    false,
  );
}

describe("the website's prices", () => {
  it("are Hop+'s monthly and yearly ones, the newest of each", async () => {
    // Newest first, as Stripe lists them.
    fake.prices = [
      // Another product the account sells, and prices that don't fit.
      price("price_invoai", "month", "prod_invoai"),
      price("price_weekly", "week"),
      price("price_quarterly", "month", PRODUCT, {
        recurring: { interval: "month", interval_count: 3 },
      }),
      price("price_off", "month", PRODUCT, { active: false }),
      price("price_new_monthly", "month"),
      price(MONTHLY, "month"),
      price(ANNUAL, "year"),
    ];
    const response = await call("/billing/web/prices");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { prices: WebPrice[] }).prices).toEqual([
      { id: "price_new_monthly", amount: 499, currency: "eur", interval: "month" },
      { id: ANNUAL, amount: 4900, currency: "eur", interval: "year" },
    ]);
    const asked = fake.calls[0];
    expect(asked?.params.get("product")).toBe(PRODUCT);
    expect(asked?.headers.get("stripe-version")).toBe(STRIPE_API_VERSION);
    expect(asked?.headers.get("authorization")).toBe("Bearer sk_test_fake");
  });

  it("are asked of Stripe once every few minutes", async () => {
    await call("/billing/web/prices");
    await call("/billing/web/prices");
    expect(stripeCalls()).toEqual(["GET /prices"]);
  });

  it("are asked again once the cache is a few minutes old", async () => {
    const now = Date.now();
    await hopPlusPrices(env, now);
    await hopPlusPrices(env, now + 4 * 60 * 1000);
    expect(stripeCalls()).toEqual(["GET /prices"]);
    await hopPlusPrices(env, now + 6 * 60 * 1000);
    expect(stripeCalls()).toEqual(["GET /prices", "GET /prices"]);
  });

  it("aren't asked again for half a minute after Stripe fails", async () => {
    const now = Date.now();
    fake.down = true;
    await expect(hopPlusPrices(env, now)).rejects.toThrow();
    fake.down = false;
    await expect(hopPlusPrices(env, now + 20_000)).rejects.toThrow();
    expect(stripeCalls()).toEqual(["GET /prices"]);
    expect(await hopPlusPrices(env, now + 31_000)).toHaveLength(2);
  });

  it("are none where Stripe isn't set up, and need a signed-in athlete", async () => {
    env = { ...env, STRIPE_SECRET_KEY: undefined };
    expect(await (await call("/billing/web/prices")).json()).toEqual({ prices: [] });
    expect((await call("/billing/web/prices", {}, false)).status).toBe(401);
    expect(fake.calls).toEqual([]);
  });
});

describe("checking out", () => {
  it("makes the athlete a customer once, and opens Checkout for Hop+", async () => {
    const response = await checkout();
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as BillingRedirect;
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const customer = (await alex())?.stripeCustomerId;
    expect(customer).toMatch(/^cus_/);
    const made = fake.calls.find((c) => c.path === "/customers");
    expect(made?.params.get("email")).toBe("alex@example.com");
    expect(made?.params.get("metadata[hop_user_id]")).toBe("usr_a");

    const opened = fake.calls.find((c) => c.method === "POST" && c.path === "/checkout/sessions");
    expect(Object.fromEntries(opened?.params ?? [])).toMatchObject({
      mode: "subscription",
      customer,
      client_reference_id: "usr_a",
      "line_items[0][price]": MONTHLY,
      "line_items[0][quantity]": "1",
      "metadata[hop_user_id]": "usr_a",
      "subscription_data[metadata][hop_user_id]": "usr_a",
      success_url: "https://onmyhop.com/app/my-hop?hopplus=welcome",
      cancel_url: "https://onmyhop.com/app/my-hop",
      // Cards only: a bank debit could fail after Hop+ was given.
      "payment_method_types[0]": "card",
      // The terms, and Hop+ starting within the 14 days to withdraw.
      "consent_collection[terms_of_service]": "required",
    });
    expect(opened?.params.has("payment_method_types[1]")).toBe(false);
    expect(opened?.params.get("custom_text[terms_of_service_acceptance][message]")).toContain(
      "[Terms](https://onmyhop.com/terms) and ask for Hop+ to start right away",
    );
    // Done: the next checkout can open.
    expect((await alex())?.stripeCheckoutAt).toBeNull();

    // Again: the same customer, and the first checkout can't be paid any more.
    expect((await checkout(ANNUAL)).status).toBe(200);
    expect(fake.calls.filter((c) => c.path === "/customers")).toHaveLength(1);
    expect(fake.sessions.map((s) => s.status)).toEqual(["expired", "open"]);
  });

  it("doesn't give Stripe an address the athlete never confirmed", async () => {
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, "usr_a"));
    expect((await checkout()).status).toBe(200);
    expect(fake.calls.find((c) => c.path === "/customers")?.params.has("email")).toBe(false);
  });

  it("is refused with Hop+ already, from the App Store or the website", async () => {
    const now = Date.now();
    await db.insert(subscriptions).values({
      originalTransactionId: "2000000000",
      userId: "usr_a",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: now + DAY,
      purchasedAt: now,
      signedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const response = await checkout();
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("already_plus");
    expect(fake.sessions).toEqual([]);
  });

  it("catches up with a checkout paid moments ago, before its webhook, so nobody pays twice", async () => {
    await linkAlex();
    fake.subscriptions.set("sub_alex", subscription());
    expect((await checkout()).status).toBe(409);
    expect((await plan()).plan).toBe("plus");
    expect(fake.sessions).toEqual([]);
  });

  it("sends someone whose Hop+ has a payment due to fix it, rather than pay twice", async () => {
    await linkAlex();
    const longAgo = nowS() - 40 * 86400;
    for (const status of ["past_due", "unpaid", "paused"] as const) {
      // Past the grace period: no Hop+, but Stripe still bills it.
      fake.subscriptions.set(
        "sub_alex",
        subscription({
          status,
          items: {
            data: [
              {
                price: price(MONTHLY, "month") as never,
                current_period_start: longAgo,
                current_period_end: longAgo + 30 * 86400,
              },
            ],
          },
        }),
      );
      const response = await checkout();
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toBe("payment_due");
    }
    expect(fake.sessions).toEqual([]);
  });

  it("cancels a subscription left waiting for its first payment, before opening another", async () => {
    await linkAlex();
    fake.subscriptions.set(
      "sub_waiting",
      subscription({ id: "sub_waiting", status: "incomplete" }),
    );
    expect((await checkout()).status).toBe(200);
    expect(fake.subscriptions.get("sub_waiting")?.status).toBe("canceled");
  });

  it("opens one checkout at a time per account", async () => {
    const now = Date.now();
    await db
      .update(users)
      .set({ stripeCheckoutAt: now - 1000 })
      .where(eq(users.id, "usr_a"));
    const busy = await checkout();
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: string }).error).toBe("checkout_opening");
    expect(fake.calls).toEqual([]);
    expect((await alex())?.stripeCheckoutAt).toBe(now - 1000);

    // A slow one keeps it; one that died holding it lets go after two minutes.
    await db
      .update(users)
      .set({ stripeCheckoutAt: now - 90_000 })
      .where(eq(users.id, "usr_a"));
    expect((await checkout()).status).toBe(409);
    await db
      .update(users)
      .set({ stripeCheckoutAt: now - 121_000 })
      .where(eq(users.id, "usr_a"));
    expect((await checkout()).status).toBe(200);
    expect((await alex())?.stripeCheckoutAt).toBeNull();
  });

  it("doesn't open a checkout once its lock may have run out", async () => {
    await expect(
      startCheckout(env, "cus_alex", "usr_a", MONTHLY, Date.now() - 1),
    ).rejects.toThrow();
    expect(
      fake.calls.filter((c) => c.method === "POST" && c.path === "/checkout/sessions"),
    ).toEqual([]);
    expect(checkoutDeadline(1_000_000)).toBeLessThanOrEqual(1_000_000 + 2 * 60 * 1000 - 10_000);
  });

  it("isn't sold without the webhook, which keeps renewals in step", async () => {
    env = { ...env, STRIPE_WEBHOOK_SECRET: undefined };
    expect(await (await call("/billing/web/prices")).json()).toEqual({ prices: [] });
    expect((await checkout()).status).toBe(503);
    // What was bought before can still be managed.
    await linkAlex();
    expect((await call("/billing/web/portal", { method: "POST" })).status).toBe(200);
    expect((await call("/billing/web/sync", { method: "POST" })).status).toBe(200);
  });

  it("lets go of the lock when Stripe fails too", async () => {
    fake.down = true;
    expect((await checkout()).status).toBe(502);
    expect((await alex())?.stripeCheckoutAt).toBeNull();
  });

  it("only sells Hop+'s own prices", async () => {
    const response = await checkout("price_invoai");
    expect(response.status).toBe(400);
    expect(fake.sessions).toEqual([]);
  });

  it("starts with a new customer when the old one was deleted in Stripe", async () => {
    await linkAlex("cus_gone");
    expect((await checkout()).status).toBe(200);
    const customer = (await alex())?.stripeCustomerId;
    expect(customer).not.toBe("cus_gone");
    expect(customer).toMatch(/^cus_/);
    expect(fake.sessions.at(-1)?.customer).toBe(customer);
  });

  it("says so when Stripe is down, isn't set up, or is asked too often", async () => {
    fake.down = true;
    expect((await checkout()).status).toBe(502);
    fake.down = false;
    limited = true;
    expect((await checkout()).status).toBe(429);
    env = { ...env, STRIPE_SECRET_KEY: undefined };
    expect((await checkout()).status).toBe(503);
    expect(fake.sessions).toEqual([]);
  });

  it("needs a signed-in athlete", async () => {
    const response = await call(
      "/billing/web/checkout",
      { method: "POST", body: JSON.stringify({ priceId: MONTHLY }) },
      false,
    );
    expect(response.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });
});

describe("the customer portal", () => {
  it("opens for the athlete's customer, and comes back to My Hop", async () => {
    await linkAlex();
    const response = await call("/billing/web/portal", { method: "POST" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as BillingRedirect).url).toMatch(/^https:\/\/billing\.stripe/);
    const opened = fake.calls.find((c) => c.path === "/billing_portal/sessions");
    expect(opened?.params.get("customer")).toBe("cus_alex");
    expect(opened?.params.get("return_url")).toBe("https://onmyhop.com/app/my-hop");
  });

  it("isn't there for someone who never bought on the website", async () => {
    expect((await call("/billing/web/portal", { method: "POST" })).status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it("uses Hop's own portal settings, where they're set", async () => {
    await linkAlex();
    await call("/billing/web/portal", { method: "POST" });
    expect(fake.calls.at(-1)?.params.has("configuration")).toBe(false);
    env = { ...env, STRIPE_PORTAL_CONFIGURATION: "bpc_hop" };
    await call("/billing/web/portal", { method: "POST" });
    expect(fake.calls.at(-1)?.params.get("configuration")).toBe("bpc_hop");
  });

  it("forgets a customer Stripe no longer has", async () => {
    await linkAlex("cus_gone");
    expect((await call("/billing/web/portal", { method: "POST" })).status).toBe(404);
    expect((await alex())?.stripeCustomerId).toBeNull();
  });
});

describe("Stripe's webhook", () => {
  beforeEach(async () => {
    await linkAlex();
  });

  it("gives Hop+ once a checkout completes, read from Stripe", async () => {
    fake.subscriptions.set("sub_alex", subscription());
    const response = await webhook("checkout.session.completed", {
      id: "cs_1",
      object: "checkout.session",
      mode: "subscription",
      subscription: "sub_alex",
    });
    expect(response.status).toBe(200);
    const status = await plan();
    expect(status.plan).toBe("plus");
    expect(status.subscription).toMatchObject({
      provider: "stripe",
      productId: "hop_plus",
      environment: "Production",
      autoRenew: true,
      graceExpiresAt: null,
    });
    expect(status.subscription?.expiresAt).toBe(
      (subscription().items.data[0]?.current_period_end ?? 0) * 1000,
    );
    expect(status.storage.limitBytes).toBe(PLANS.plus.storageBytes);
  });

  it("follows the subscription through every event about it", async () => {
    fake.subscriptions.set("sub_alex", subscription({ interval: "year" }));
    await webhook("customer.subscription.created", { id: "sub_alex", object: "subscription" });
    expect((await plan()).subscription?.productId).toBe("hop_plus_annual");

    // Cancelled in the portal: Hop+ until the period ends, then no renewal.
    fake.subscriptions.set("sub_alex", subscription({ cancel_at_period_end: true }));
    await webhook("customer.subscription.updated", { id: "sub_alex", object: "subscription" });
    expect((await plan()).subscription?.autoRenew).toBe(false);

    // Invoices name it under parent (newer API versions) or directly (older).
    fake.subscriptions.set("sub_alex", subscription());
    await webhook("invoice.paid", {
      id: "in_1",
      object: "invoice",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_alex" } },
    });
    expect((await plan()).subscription?.autoRenew).toBe(true);
    fake.subscriptions.set("sub_alex", subscription({ status: "canceled", ended_at: nowS() - 1 }));
    await webhook("invoice.payment_failed", {
      id: "in_2",
      object: "invoice",
      subscription: "sub_alex",
    });
    expect((await plan()).plan).toBe("free");
  });

  it("ignores events Hop has no use for, without asking Stripe", async () => {
    const response = await webhook("charge.succeeded", { id: "ch_1", object: "charge" });
    expect(response.status).toBe(200);
    expect(
      await webhook("checkout.session.completed", { mode: "payment", subscription: null }),
    ).toHaveProperty("status", 200);
    expect(fake.calls).toEqual([]);
  });

  it("ignores the account's other products, and customers that aren't athletes", async () => {
    fake.subscriptions.set(
      "sub_invoai",
      subscription({ id: "sub_invoai", product: "prod_invoai" }),
    );
    fake.subscriptions.set("sub_stranger", subscription({ id: "sub_stranger", customer: "cus_x" }));
    for (const id of ["sub_invoai", "sub_stranger"]) {
      const response = await webhook("customer.subscription.created", { id });
      expect(response.status).toBe(200);
    }
    expect(await db.select().from(subscriptions)).toEqual([]);
    expect(fake.calls.filter((c) => c.method === "DELETE")).toEqual([]);
  });

  it("is refused unless Stripe signed it, recently, with this endpoint's secret", async () => {
    fake.subscriptions.set("sub_alex", subscription());
    const object = { id: "sub_alex" };
    const type = "customer.subscription.created";
    const refused = [
      await webhook(type, object, { header: (body) => signature(body, "whsec_other") }),
      await webhook(type, object, { header: (body) => signature(body, WHSEC, nowS() - 600) }),
      await webhook(type, object, { header: (body) => signature(`${body} `) }),
      await webhook(type, object, { header: async () => "" }),
      await webhook(type, object, { header: async () => "t=1,v1=zz" }),
    ];
    expect(refused.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(fake.calls).toEqual([]);

    // While Stripe rolls the secret, it signs with both.
    const both = await webhook(type, object, {
      header: async (body) => {
        const old = await signature(body, "whsec_old");
        const current = await signature(body);
        return `${old},${current.split(",")[1]}`;
      },
    });
    expect(both.status).toBe(200);
    expect((await plan()).plan).toBe("plus");
  });

  it("ignores test-mode events in production, and isn't there without its secret", async () => {
    fake.subscriptions.set("sub_alex", subscription());
    const test = await webhook(
      "customer.subscription.created",
      { id: "sub_alex" },
      { livemode: false },
    );
    // A 200 all the same, or Stripe would retry it for days.
    expect(test.status).toBe(200);
    expect(await db.select().from(subscriptions)).toEqual([]);
    env = { ...env, STRIPE_WEBHOOK_SECRET: undefined };
    expect((await webhook("customer.subscription.created", { id: "sub_alex" })).status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  it("fails while Stripe is down, so Stripe sends it again", async () => {
    fake.down = true;
    const response = await webhook("customer.subscription.created", { id: "sub_alex" });
    expect(response.status).toBe(500);
  });

  it("never gives a deleted account Hop+, even one still holding its customer", async () => {
    // As when a checkout under way stored the customer just after the deletion.
    await db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, "usr_a"));
    fake.subscriptions.set("sub_alex", subscription());
    expect((await webhook("customer.subscription.created", { id: "sub_alex" })).status).toBe(200);
    expect(await db.select().from(subscriptions)).toEqual([]);
    expect(fake.subscriptions.get("sub_alex")?.status).toBe("canceled");
  });

  it("ends Hop+ for a subscription moved to another product", async () => {
    fake.subscriptions.set("sub_alex", subscription());
    await webhook("customer.subscription.created", { id: "sub_alex" });
    const before = await plan();
    expect(before.plan).toBe("plus");
    fake.subscriptions.set("sub_alex", subscription({ product: "prod_invoai" }));
    await webhook("customer.subscription.updated", { id: "sub_alex" });
    const after = await plan();
    expect(after.plan).toBe("free");
    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it("ends Hop+ for a subscription Stripe no longer has", async () => {
    fake.subscriptions.set("sub_alex", subscription());
    await webhook("customer.subscription.created", { id: "sub_alex" });
    fake.subscriptions.delete("sub_alex");
    expect((await webhook("customer.subscription.deleted", { id: "sub_alex" })).status).toBe(200);
    expect((await plan()).plan).toBe("free");
  });

  it("cancels a deleted account's subscription even if a row of it was left behind", async () => {
    // Stored by a request under way as the account went (the cleanup erases it later).
    await syncSubscription(env, db, subscription(), Date.now() - 1000);
    await db
      .update(users)
      .set({ deletedAt: Date.now(), stripeCustomerId: null })
      .where(eq(users.id, "usr_a"));
    fake.subscriptions.set("sub_alex", subscription());
    expect((await webhook("customer.subscription.updated", { id: "sub_alex" })).status).toBe(200);
    expect(fake.subscriptions.get("sub_alex")?.status).toBe("canceled");
  });

  it("cancels a subscription paid for after its account was deleted", async () => {
    // The checkout was open when Alex deleted the account, and paid after.
    await db
      .update(users)
      .set({ deletedAt: Date.now(), stripeCustomerId: null })
      .where(eq(users.id, "usr_a"));
    fake.subscriptions.set("sub_alex", subscription());
    expect((await webhook("customer.subscription.created", { id: "sub_alex" })).status).toBe(200);
    expect(fake.subscriptions.get("sub_alex")?.status).toBe("canceled");
    expect(await db.select().from(subscriptions)).toEqual([]);
  });
});

describe("a Stripe subscription, stored", () => {
  beforeEach(async () => {
    await linkAlex();
  });

  const stored = () =>
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.originalTransactionId, "sub_alex"))
      .get();

  it("is never rolled back by data fetched earlier", async () => {
    const now = Date.now();
    await syncSubscription(env, db, subscription(), now);
    await syncSubscription(env, db, subscription({ cancel_at_period_end: true }), now - 1000);
    expect((await stored())?.autoRenew).toBe(true);
    await syncSubscription(env, db, subscription({ cancel_at_period_end: true }), now + 1000);
    expect((await stored())?.autoRenew).toBe(false);
  });

  it("is only stored in the mode this environment uses", async () => {
    expect(await syncSubscription(env, db, subscription({ livemode: false }), Date.now())).toBe(
      "wrong_mode",
    );
    env = { ...env, ENVIRONMENT: "staging" };
    expect(await syncSubscription(env, db, subscription({ livemode: false }), Date.now())).toBe(
      "stored",
    );
    expect((await stored())?.environment).toBe("Sandbox");
  });

  it("isn't stored when it was never paid", async () => {
    for (const status of ["incomplete", "incomplete_expired"] as const) {
      expect(await syncSubscription(env, db, subscription({ status }), Date.now())).toBe(
        "never_paid",
      );
    }
    expect(await stored()).toBeUndefined();
  });

  it("can't take over an App Store subscription with the same ID", async () => {
    const now = Date.now();
    await db.insert(subscriptions).values({
      originalTransactionId: "sub_alex",
      userId: "usr_a",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: now - DAY,
      purchasedAt: now - 2 * DAY,
      signedAt: now - 2 * DAY,
      createdAt: now,
      updatedAt: now,
    });
    await syncSubscription(env, db, subscription(), now);
    expect((await stored())?.expiresAt).toBe(now - DAY);
  });

  it("goes up the plan's revision", async () => {
    const before = (await plan()).revision;
    await syncSubscription(env, db, subscription(), Date.now());
    expect((await plan()).revision).toBe(before + 1);
  });

  it("counts toward the storage limit like any Hop+", async () => {
    await syncSubscription(env, db, subscription(), Date.now());
    const row = await db.get<{ limit: number }>(
      sql`select ${storageLimitSql("usr_a", Date.now())} as "limit"`,
    );
    expect(row?.limit).toBe(PLANS.plus.storageBytes);
  });
});

describe("what a Stripe subscription gives", () => {
  const start = nowS() - 60;
  const end = nowS() + 30 * 86400;
  const at = (status: StripeSubscription["status"], extra: Partial<StripeSubscription> = {}) =>
    stripeTerms({
      ...subscription({ status, ...extra }),
      items: {
        data: [
          {
            price: price(MONTHLY, "month") as never,
            current_period_start: start,
            current_period_end: end,
          },
        ],
      },
    });

  it("is Hop+ to the period's end while paid up", () => {
    expect(at("active")).toEqual({ expiresAt: end * 1000, graceExpiresAt: null, autoRenew: true });
    expect(at("trialing", { cancel_at: end })?.autoRenew).toBe(false);
  });

  it("is a grace period while Stripe retries a failed renewal", () => {
    expect(at("past_due")).toEqual({
      expiresAt: start * 1000,
      graceExpiresAt: Math.min(end * 1000, start * 1000 + PAST_DUE_GRACE_MS),
      autoRenew: true,
    });
  });

  it("ends when it's cancelled, or when retries run out", () => {
    expect(at("canceled", { ended_at: start + 10 })).toEqual({
      expiresAt: (start + 10) * 1000,
      graceExpiresAt: null,
      autoRenew: false,
    });
    expect(at("unpaid")?.expiresAt).toBe(start * 1000);
    expect(at("paused")?.expiresAt).toBe(start * 1000);
  });

  it("is nothing before the first payment", () => {
    expect(at("incomplete")).toBeNull();
  });
});

describe("catching up with Stripe", () => {
  it("reads the athlete's subscriptions back from Checkout, before the webhook", async () => {
    await linkAlex();
    fake.subscriptions.set("sub_alex", subscription());
    const response = await call("/billing/web/sync", { method: "POST" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as PlanStatus).plan).toBe("plus");
  });

  it("forgets a customer Stripe no longer has", async () => {
    await linkAlex("cus_gone");
    const response = await call("/billing/web/sync", { method: "POST" });
    expect(response.status).toBe(200);
    expect((await alex())?.stripeCustomerId).toBeNull();
  });

  it("sees a cancellation the webhook hasn't brought yet", async () => {
    await linkAlex();
    fake.subscriptions.set("sub_alex", subscription());
    await call("/billing/web/sync", { method: "POST" });
    expect((await plan()).plan).toBe("plus");
    // Cancelled at once in Stripe's dashboard.
    fake.subscriptions.set("sub_alex", subscription({ status: "canceled", ended_at: nowS() - 5 }));
    fake.calls = [];
    const response = await call("/billing/web/sync", { method: "POST" });
    expect(((await response.json()) as PlanStatus).plan).toBe("free");
    // One list, ended ones and all: nothing asked of Stripe one by one.
    expect(stripeCalls()).toEqual(["GET /subscriptions"]);
    // So Hop+ can be bought again.
    expect((await checkout()).status).toBe(200);
  });

  it("ends Hop+ whose customer was deleted in Stripe", async () => {
    // Stored while the customer existed; deleting it cancelled the subscription.
    await linkAlex("cus_gone");
    await syncSubscription(env, db, subscription({ customer: "cus_gone" }), Date.now() - 1000);
    expect((await plan()).plan).toBe("plus");
    fake.subscriptions.set(
      "sub_alex",
      subscription({ customer: "cus_gone", status: "canceled", ended_at: nowS() - 5 }),
    );
    const response = await call("/billing/web/sync", { method: "POST" });
    expect(((await response.json()) as PlanStatus).plan).toBe("free");
    expect((await alex())?.stripeCustomerId).toBeNull();
  });

  it("is just the plan for someone who never bought on the website", async () => {
    const response = await call("/billing/web/sync", { method: "POST" });
    expect(((await response.json()) as PlanStatus).plan).toBe("free");
    expect(fake.calls).toEqual([]);
  });
});

describe("deleting an account with Hop+ from the website", () => {
  const deleteMe = () => call("/me", { method: "DELETE" });

  beforeEach(async () => {
    await linkAlex();
    fake.subscriptions.set("sub_alex", subscription());
    fake.subscriptions.set(
      "sub_invoai",
      subscription({ id: "sub_invoai", product: "prod_invoai" }),
    );
    fake.sessions.push({ id: "cs_open", customer: "cus_alex", status: "open" });
    await syncSubscription(env, db, subscription(), Date.now());
  });

  it("cancels it, and any checkout left open, before the account goes", async () => {
    const response = await deleteMe();
    expect(response.status).toBe(200);
    expect(fake.subscriptions.get("sub_alex")?.status).toBe("canceled");
    expect(fake.sessions[0]?.status).toBe("expired");
    // Everything on Hop's customer, even a subscription moved to another product.
    expect(fake.subscriptions.get("sub_invoai")?.status).toBe("canceled");

    const row = await alex();
    expect(row?.deletedAt).toBeTypeOf("number");
    expect(row?.stripeCustomerId).toBeNull();
    expect(await db.select().from(subscriptions)).toEqual([]);
  });

  it("keeps the account while Stripe can't be reached, so it isn't billed after", async () => {
    fake.down = true;
    const response = await deleteMe();
    expect(response.status).toBe(503);
    const row = await alex();
    expect(row?.deletedAt).toBeNull();
    expect(row?.stripeCustomerId).toBe("cus_alex");
    // Free to try again, or to check out.
    expect(row?.stripeCheckoutAt).toBeNull();
    // Still signed in, to try again.
    expect((await call("/me/plan")).status).toBe(200);
  });

  it("waits for a checkout that's opening, which may be making the customer", async () => {
    await db.update(users).set({ stripeCheckoutAt: Date.now() }).where(eq(users.id, "usr_a"));
    const response = await deleteMe();
    expect(response.status).toBe(409);
    expect((await alex())?.deletedAt).toBeNull();
  });

  it("goes ahead when Stripe no longer has the customer, which can't be billed", async () => {
    await linkAlex("cus_gone");
    const response = await deleteMe();
    expect(response.status).toBe(200);
    expect((await alex())?.deletedAt).toBeTypeOf("number");
  });

  it("is refused where Stripe isn't set up, rather than leave it billing", async () => {
    const configured = env;
    for (const unset of [{ STRIPE_SECRET_KEY: undefined }, { STRIPE_PRODUCT_ID: "" }]) {
      env = { ...configured, ...unset };
      expect((await deleteMe()).status).toBe(503);
      expect((await alex())?.deletedAt).toBeNull();
    }
    expect(fake.subscriptions.get("sub_alex")?.status).toBe("active");
  });
});

describe("Stripe's form encoding", () => {
  it("nests objects and lists in brackets, and leaves out what's unset", () => {
    expect(
      formEncode({
        mode: "subscription",
        line_items: [{ price: "price_1", quantity: 1 }],
        metadata: { hop_user_id: "usr_a" },
        email: undefined,
        expand: ["latest_invoice"],
      }).toString(),
    ).toBe(
      "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Bhop_user_id%5D=usr_a&expand%5B0%5D=latest_invoice",
    );
  });
});
