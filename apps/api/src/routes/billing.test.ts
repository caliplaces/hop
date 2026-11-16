import { PLANS, type PlanStatus } from "@hop/shared";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { sessions, subscriptions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { randomToken, sha256Hex } from "../lib/crypto";
import { storageLimitSql } from "../lib/plans";
import { makePki, signLikeApple, type TestPki, trustedRoot } from "../test/apple";
import { createTestD1 } from "../test/d1";

const trust = vi.hoisted(() => ({ roots: [] as string[] }));
vi.mock("../lib/apple-roots", () => ({
  get APPLE_ROOT_CERTIFICATES() {
    return trust.roots;
  },
}));

const DAY = 24 * 60 * 60 * 1000;
let pki: TestPki;
let env: Env;
let db: ReturnType<typeof getDb>;
let session: string;
/** When the test's subscription was bought: copies of one transaction share it. */
let purchased: number;

beforeAll(async () => {
  pki = await makePki();
  trust.roots = [trustedRoot(pki)];
});

beforeEach(async () => {
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    APPLE_BUNDLE_ID: "com.onmyhop.app",
    APPLE_APP_ID: "6834920854",
  } as Env;
  db = getDb(DB);
  const now = Date.now();
  purchased = now - 1000;
  await db.insert(users).values([
    { id: "usr_a", oidcSub: "sub-a", handle: "alex", createdAt: now, updatedAt: now },
    { id: "usr_b", oidcSub: "sub-b", handle: "blake", createdAt: now, updatedAt: now },
  ]);
  session = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(session),
    userId: "usr_a",
    kind: "app",
    createdAt: now,
    expiresAt: now + DAY,
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function call(path: string, init: RequestInit = {}, auth = true) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: {
        ...(auth ? { authorization: `Bearer ${session}` } : {}),
        "content-type": "application/json",
      },
    }),
    env,
    {} as ExecutionContext,
  );
}

const plan = async () => (await (await call("/me/plan")).json()) as PlanStatus;

/** Gives another athlete an appAccountToken, as their own app would have. */
async function tokenFor(userId: string) {
  const token = crypto.randomUUID();
  await db.update(users).set({ appAccountToken: token }).where(eq(users.id, userId));
  return token;
}

type Tx = Record<string, unknown>;
function transaction(token: string, overrides: Tx = {}): Tx {
  const now = Date.now();
  return {
    transactionId: "2000000001",
    originalTransactionId: "2000000000",
    bundleId: "com.onmyhop.app",
    productId: "hop_plus",
    type: "Auto-Renewable Subscription",
    purchaseDate: purchased,
    expiresDate: now + 30 * DAY,
    appAccountToken: token,
    environment: "Production",
    signedDate: now,
    ...overrides,
  };
}

const send = async (tx: Tx) =>
  call("/me/subscriptions/apple", {
    method: "POST",
    body: JSON.stringify({ transaction: await signLikeApple(pki, tx) }),
  });

async function notify(type: string, data: Record<string, unknown>, signedDate = Date.now()) {
  const payload = {
    notificationType: type,
    notificationUUID: crypto.randomUUID(),
    data,
    signedDate,
  };
  return call(
    "/apple/notifications",
    { method: "POST", body: JSON.stringify({ signedPayload: await signLikeApple(pki, payload) }) },
    false,
  );
}

const appData = async (tx: Tx, renewal?: Tx) => ({
  appAppleId: 6834920854,
  bundleId: "com.onmyhop.app",
  environment: "Production",
  signedTransactionInfo: await signLikeApple(pki, tx),
  ...(renewal ? { signedRenewalInfo: await signLikeApple(pki, renewal) } : {}),
});

describe("the plan", () => {
  it("starts free, with an account token that stays the same", async () => {
    const first = await plan();
    expect(first.plan).toBe("free");
    expect(first.storage).toEqual({ usedBytes: 0, limitBytes: PLANS.free.storageBytes });
    expect(first.retentionDays).toBe(PLANS.free.retentionDays);
    expect(first.subscription).toBeNull();
    expect(first.appAccountToken).toMatch(/^[0-9a-f-]{36}$/);
    expect((await plan()).appAccountToken).toBe(first.appAccountToken);
    expect(first.plans).toEqual(PLANS);
  });
});

describe("a purchase from the app", () => {
  it("gives Hop+ when it carries this account's token", async () => {
    const { appAccountToken } = await plan();
    const response = await send(transaction(appAccountToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as PlanStatus;
    expect(body.plan).toBe("plus");
    expect(body.storage.limitBytes).toBe(PLANS.plus.storageBytes);
    expect(body.retentionDays).toBeNull();
    expect(body.subscription).toMatchObject({
      productId: "hop_plus",
      autoRenew: true,
      environment: "Production",
    });
  });

  it("is refused for another account, another app or another product", async () => {
    const { appAccountToken } = await plan();
    expect((await send(transaction(crypto.randomUUID()))).status).toBe(403);
    expect((await send(transaction(appAccountToken, { bundleId: "com.other.app" }))).status).toBe(
      400,
    );
    expect((await send(transaction(appAccountToken, { productId: "coins_100" }))).status).toBe(400);
    expect((await send(transaction(appAccountToken, { type: "Consumable" }))).status).toBe(400);
    expect((await send(transaction(appAccountToken, { environment: "Xcode" }))).status).toBe(400);
    expect((await plan()).plan).toBe("free");
  });

  it("is refused when it isn't signed by Apple", async () => {
    const { appAccountToken } = await plan();
    const forged = await makePki();
    const response = await call("/me/subscriptions/apple", {
      method: "POST",
      body: JSON.stringify({
        transaction: await signLikeApple(forged, transaction(appAccountToken)),
      }),
    });
    expect(response.status).toBe(400);
    expect((await plan()).plan).toBe("free");
  });

  it("can't take over a subscription another account already has", async () => {
    const { appAccountToken } = await plan();
    await db.insert(subscriptions).values({
      originalTransactionId: "2000000000",
      userId: "usr_b",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: Date.now() + DAY,
      purchasedAt: Date.now(),
      signedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect((await send(transaction(appAccountToken))).status).toBe(403);
    const row = await db.select().from(subscriptions).get();
    expect(row?.userId).toBe("usr_b");
  });

  it("moves the subscription when the same Apple ID subscribes again from another account", async () => {
    const now = Date.now();
    const tokenB = await tokenFor("usr_b");
    // Bought from account B, then lapsed.
    await notify(
      "SUBSCRIBED",
      await appData(
        transaction(tokenB, { purchaseDate: now - 60 * DAY, expiresDate: now - 30 * DAY }),
      ),
    );
    // Restoring B's old purchase on account A doesn't move it.
    const { appAccountToken } = await plan();
    const old = transaction(tokenB, { purchaseDate: now - 60 * DAY, expiresDate: now - 30 * DAY });
    expect((await send(old)).status).toBe(403);
    // A new purchase from account A does, as only that Apple ID can make one.
    const response = await send(transaction(appAccountToken, { transactionId: "2000000009" }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as PlanStatus).plan).toBe("plus");
    const row = await db.select().from(subscriptions).get();
    expect(row?.userId).toBe("usr_a");
    // And B's old purchase, arriving late, can't take it back, or bring its renewal info.
    const oldRenewal = {
      originalTransactionId: "2000000000",
      autoRenewStatus: 0,
      gracePeriodExpiresDate: now + 3 * DAY,
      environment: "Production",
      signedDate: now + 1000,
    };
    await notify("EXPIRED", await appData({ ...old, signedDate: now + 1000 }, oldRenewal));
    expect(await db.select().from(subscriptions).get()).toMatchObject({
      userId: "usr_a",
      graceExpiresAt: null,
      autoRenew: true,
    });
  });

  it("ignores an upgraded transaction, so a refunded upgrade can't bring Hop+ back", async () => {
    const { appAccountToken } = await plan();
    const now = Date.now();
    const monthly = transaction(appAccountToken, {
      purchaseDate: now - DAY,
      expiresDate: now + 29 * DAY,
      signedDate: now - DAY,
    });
    await send(monthly);
    // Upgraded to annual today, then the annual was refunded.
    const annual = transaction(appAccountToken, {
      transactionId: "2000000003",
      productId: "hop_plus_annual",
      purchaseDate: now,
      expiresDate: now + 365 * DAY,
      signedDate: now,
    });
    await send(annual);
    await notify(
      "REFUND",
      await appData({ ...annual, revocationDate: now + 1000, signedDate: now + 1000 }),
    );
    expect((await plan()).plan).toBe("free");

    // The superseded monthly, signed again later, changes nothing.
    const resigned = { ...monthly, isUpgraded: true, signedDate: now + 2000 };
    expect((await send(resigned)).status).toBe(200);
    expect((await plan()).plan).toBe("free");
    // Not even without the upgraded flag: it's an older purchase.
    expect((await send({ ...monthly, signedDate: now + 3000 })).status).toBe(200);
    expect((await plan()).plan).toBe("free");
  });

  it("ignores an upgraded transaction even when it's the first one seen", async () => {
    const { appAccountToken } = await plan();
    const response = await send(transaction(appAccountToken, { isUpgraded: true }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as PlanStatus).plan).toBe("free");
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });
});

describe("sandbox purchases", () => {
  const sandbox = (token: string) => transaction(token, { environment: "Sandbox" });

  it("never overwrite a production subscription, whatever its ID", async () => {
    const tokenB = await tokenFor("usr_b");
    await notify("SUBSCRIBED", await appData(transaction(tokenB)));
    env.APPLE_SANDBOX_USERS = "usr_a";
    const { appAccountToken } = await plan();
    const clash = { ...sandbox(appAccountToken), purchaseDate: Date.now() + 1000 };
    expect((await send(clash)).status).toBe(403);
    const row = await db.select().from(subscriptions).get();
    expect(row).toMatchObject({ userId: "usr_b", environment: "Production" });
  });

  it("don't unlock Hop+ in production, except for listed accounts", async () => {
    const { appAccountToken } = await plan();
    const refused = await send(sandbox(appAccountToken));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "test_purchase" });
    expect((await plan()).plan).toBe("free");

    env.APPLE_SANDBOX_USERS = "usr_x, usr_a";
    expect((await send(sandbox(appAccountToken))).status).toBe(200);
    expect((await plan()).plan).toBe("plus");
  });

  it("don't count when the environment isn't set", async () => {
    (env as Partial<Env>).ENVIRONMENT = undefined;
    const { appAccountToken } = await plan();
    expect((await send(sandbox(appAccountToken))).status).toBe(403);
  });

  it("always count on staging", async () => {
    env.ENVIRONMENT = "staging";
    const { appAccountToken } = await plan();
    expect((await send(sandbox(appAccountToken))).status).toBe(200);
    expect((await plan()).plan).toBe("plus");
  });
});

describe("App Store notifications", () => {
  it("renew, lapse and refund the subscription", async () => {
    const { appAccountToken } = await plan();
    await send(transaction(appAccountToken));
    const later = Date.now() + 1000;

    // Renewed for another month, with auto-renew switched off meanwhile.
    const renewed = transaction(appAccountToken, {
      transactionId: "2000000002",
      purchaseDate: later,
      expiresDate: Date.now() + 60 * DAY,
      signedDate: later,
    });
    const renewal = {
      originalTransactionId: "2000000000",
      autoRenewStatus: 0,
      environment: "Production",
      signedDate: later,
    };
    expect((await notify("DID_RENEW", await appData(renewed, renewal))).status).toBe(200);
    let status = await plan();
    expect(status.plan).toBe("plus");
    expect(status.subscription?.autoRenew).toBe(false);
    expect(status.subscription?.expiresAt).toBe(renewed.expiresDate);

    // Refunded: Hop+ ends at once.
    const refunded = { ...renewed, revocationDate: later + 1000, signedDate: later + 1000 };
    await notify("REFUND", await appData(refunded));
    status = await plan();
    expect(status.plan).toBe("free");
  });

  it("keep Hop+ through a billing grace period, then end it", async () => {
    const { appAccountToken } = await plan();
    const now = Date.now();
    const lapsed = transaction(appAccountToken, { expiresDate: now - DAY, signedDate: now });
    const grace = {
      originalTransactionId: "2000000000",
      autoRenewStatus: 1,
      gracePeriodExpiresDate: now + 3 * DAY,
      environment: "Production",
      signedDate: now,
    };
    await notify("DID_FAIL_TO_RENEW", { ...(await appData(lapsed, grace)) });
    let status = await plan();
    expect(status.plan).toBe("plus");
    expect(status.subscription?.graceExpiresAt).toBe(grace.gracePeriodExpiresDate);

    // StoreKit still lists it, so the app sends it again, signed later.
    expect((await send({ ...lapsed, signedDate: now + 500 })).status).toBe(200);
    status = await plan();
    expect(status.plan).toBe("plus");
    expect(status.subscription?.graceExpiresAt).toBe(grace.gracePeriodExpiresDate);

    const over = { ...grace, gracePeriodExpiresDate: now - 1000, signedDate: now + 1000 };
    await notify(
      "GRACE_PERIOD_EXPIRED",
      await appData({ ...lapsed, signedDate: now + 1000 }, over),
    );
    expect((await plan()).plan).toBe("free");
  });

  it("start a grace period Apple signed before an app sync, but delivered after", async () => {
    const { appAccountToken } = await plan();
    const now = Date.now();
    const lapsed = transaction(appAccountToken, { expiresDate: now - DAY, signedDate: now });
    // The phone syncs the lapsed transaction first, signed a moment later...
    await send({ ...lapsed, signedDate: now + 2000 });
    expect((await plan()).plan).toBe("free");
    // ...then Apple's notification, signed earlier, arrives with the grace period.
    const grace = {
      originalTransactionId: "2000000000",
      autoRenewStatus: 1,
      gracePeriodExpiresDate: now + 3 * DAY,
      environment: "Production",
      signedDate: now,
    };
    await notify("DID_FAIL_TO_RENEW", await appData(lapsed, grace));
    expect((await plan()).plan).toBe("plus");
  });

  it("never let older renewal info undo newer", async () => {
    const { appAccountToken } = await plan();
    const now = Date.now();
    const lapsed = transaction(appAccountToken, { expiresDate: now - DAY, signedDate: now });
    const renewal = { originalTransactionId: "2000000000", environment: "Production" };
    // Grace over, then a delayed notification from when it began.
    await notify(
      "GRACE_PERIOD_EXPIRED",
      await appData(lapsed, { ...renewal, autoRenewStatus: 0, signedDate: now + 1000 }),
    );
    await notify(
      "DID_FAIL_TO_RENEW",
      await appData(lapsed, {
        ...renewal,
        autoRenewStatus: 1,
        gracePeriodExpiresDate: now + 3 * DAY,
        signedDate: now,
      }),
    );
    const status = await plan();
    expect(status.plan).toBe("free");
    const row = await db.select().from(subscriptions).get();
    expect(row).toMatchObject({ graceExpiresAt: null, autoRenew: false });
  });

  it("end a grace period when the next renewal comes in, with or without renewal info", async () => {
    const { appAccountToken } = await plan();
    const now = Date.now();
    const lapsed = transaction(appAccountToken, { expiresDate: now - DAY, signedDate: now });
    const grace = {
      originalTransactionId: "2000000000",
      autoRenewStatus: 1,
      gracePeriodExpiresDate: now + 40 * DAY,
      environment: "Production",
      signedDate: now,
    };
    await notify("DID_FAIL_TO_RENEW", await appData(lapsed, grace));
    // The payment went through; the app sends the renewal before Apple notifies.
    const renewed = transaction(appAccountToken, {
      transactionId: "2000000004",
      purchaseDate: now + 1000,
      expiresDate: now + 30 * DAY,
      signedDate: now + 1000,
    });
    expect((await send(renewed)).status).toBe(200);
    let row = await db.select().from(subscriptions).get();
    expect(row?.graceExpiresAt).toBeNull();
    expect((await plan()).subscription?.expiresAt).toBe(renewed.expiresDate);

    // A late notification about the old purchase can't bring its grace back.
    await notify(
      "DID_CHANGE_RENEWAL_STATUS",
      await appData(lapsed, { ...grace, autoRenewStatus: 0, signedDate: now + 500 }),
    );
    row = await db.select().from(subscriptions).get();
    expect(row).toMatchObject({ graceExpiresAt: null, autoRenew: true });
  });

  it("never let older data roll a subscription back", async () => {
    const { appAccountToken } = await plan();
    const now = Date.now();
    await send(transaction(appAccountToken, { expiresDate: now + 60 * DAY, signedDate: now }));
    // An older notification, arriving late, says it had expired.
    await notify(
      "EXPIRED",
      await appData(
        transaction(appAccountToken, { expiresDate: now - DAY, signedDate: now - DAY }),
      ),
    );
    expect((await plan()).plan).toBe("plus");
  });

  it("find the account by token for a purchase the app hasn't sent yet", async () => {
    const { appAccountToken } = await plan();
    await notify("SUBSCRIBED", await appData(transaction(appAccountToken)));
    expect((await plan()).plan).toBe("plus");
  });

  it("answer 200 for subscriptions no account has, and for tests", async () => {
    expect(
      (await notify("SUBSCRIBED", await appData(transaction(crypto.randomUUID())))).status,
    ).toBe(200);
    expect(
      (await notify("TEST", { bundleId: "com.onmyhop.app", environment: "Sandbox" })).status,
    ).toBe(200);
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });

  it("are refused when unsigned, for another app, or for another app ID in production", async () => {
    const { appAccountToken } = await plan();
    const forged = await makePki();
    const payload = {
      notificationType: "SUBSCRIBED",
      notificationUUID: "x",
      data: await appData(transaction(appAccountToken)),
      signedDate: Date.now(),
    };
    const unsigned = await call(
      "/apple/notifications",
      {
        method: "POST",
        body: JSON.stringify({ signedPayload: await signLikeApple(forged, payload) }),
      },
      false,
    );
    expect(unsigned.status).toBe(400);
    const tx = transaction(appAccountToken);
    expect(
      (await notify("SUBSCRIBED", { ...(await appData(tx)), bundleId: "com.other.app" })).status,
    ).toBe(400);
    expect((await notify("SUBSCRIBED", { ...(await appData(tx)), appAppleId: 1 })).status).toBe(
      400,
    );
    // Sandbox notifications carry no app ID.
    env.ENVIRONMENT = "staging";
    const sandbox = {
      ...(await appData({ ...tx, environment: "Sandbox" })),
      environment: "Sandbox",
      appAppleId: undefined,
    };
    expect((await notify("SUBSCRIBED", sandbox)).status).toBe(200);
    expect((await plan()).plan).toBe("plus");
  });
});

describe("the plan's revision", () => {
  const revisionOf = async (userId: string) =>
    (
      await db
        .select({ revision: users.planRevision })
        .from(users)
        .where(eq(users.id, userId))
        .get()
    )?.revision;

  it("goes up with every change, and only then", async () => {
    const { appAccountToken, revision } = await plan();
    expect((await plan()).revision).toBe(revision);

    const bought = (await (await send(transaction(appAccountToken))).json()) as PlanStatus;
    expect(bought.revision).toBe(revision + 1);
    expect((await plan()).revision).toBe(revision + 1);

    const refunded = { revocationDate: Date.now(), signedDate: Date.now() + 1000 };
    await notify("REFUND", await appData(transaction(appAccountToken, refunded)));
    expect((await plan()).revision).toBe(revision + 2);
  });

  it("goes up for both accounts when a subscription moves", async () => {
    const now = Date.now();
    const tokenB = await tokenFor("usr_b");
    await notify(
      "SUBSCRIBED",
      await appData(
        transaction(tokenB, { purchaseDate: now - 60 * DAY, expiresDate: now - 30 * DAY }),
      ),
    );
    const [a, b] = [await revisionOf("usr_a"), await revisionOf("usr_b")];
    const { appAccountToken } = await plan();
    await send(transaction(appAccountToken, { transactionId: "2000000009" }));
    expect(await revisionOf("usr_a")).toBe((a ?? 0) + 1);
    expect(await revisionOf("usr_b")).toBe((b ?? 0) + 1);
  });
});

describe("malformed requests", () => {
  it("get a 400 or 413, never a server error", async () => {
    const nul = btoa("null").replace(/=+$/, "");
    const malformed = await call(
      "/apple/notifications",
      { method: "POST", body: JSON.stringify({ signedPayload: `${nul}.${nul}.AAAA` }) },
      false,
    );
    expect(malformed.status).toBe(400);
    const huge = await call(
      "/apple/notifications",
      { method: "POST", body: JSON.stringify({ signedPayload: "a".repeat(200_000) }) },
      false,
    );
    expect(huge.status).toBe(413);
    const hugePurchase = await call("/me/subscriptions/apple", {
      method: "POST",
      body: JSON.stringify({ transaction: "a".repeat(200_000) }),
    });
    expect(hugePurchase.status).toBe(413);
  });
});

describe("the storage limit", () => {
  const limit = async (userId: string) =>
    (await db.get<{ limit: number }>(sql`select ${storageLimitSql(userId, Date.now())} as "limit"`))
      .limit;

  it("follows the plan", async () => {
    expect(await limit("usr_a")).toBe(PLANS.free.storageBytes);
    const { appAccountToken } = await plan();
    await send(transaction(appAccountToken));
    expect(await limit("usr_a")).toBe(PLANS.plus.storageBytes);
    expect(await limit("usr_b")).toBe(PLANS.free.storageBytes);

    await db
      .update(subscriptions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(subscriptions.userId, "usr_a"));
    expect(await limit("usr_a")).toBe(PLANS.free.storageBytes);
  });
});
