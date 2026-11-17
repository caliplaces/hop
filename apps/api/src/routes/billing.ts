import { appleTransactionSchema, HOP_PLUS_PRODUCT_IDS, PLANS, type PlanStatus } from "@hop/shared";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type Db, getDb } from "../db";
import { files, subscriptions, type UserRow, users } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { expiring } from "../expiry";
import {
  type AppleNotification,
  type AppleRenewalInfo,
  AppleSignatureError,
  type AppleTransaction,
  verifyAppleSigned,
} from "../lib/apple";
import { fail } from "../lib/http";
import { activeSubscription } from "../lib/plans";
import { currentUser, requireUser } from "../lib/session";
import { stripeEnabled } from "../lib/stripe";
import { validate } from "../lib/validate";

/**
 * Hop+ through the App Store. The API is the one source of truth for an
 * athlete's plan: it only trusts data Apple signed (see lib/apple.ts), from
 * the app after a purchase or restore, and from App Store Server
 * Notifications V2 for renewals, cancellations and refunds.
 */

class SubscriptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The athlete's appAccountToken, made the first time it's asked for. */
async function appAccountToken(db: Db, user: UserRow): Promise<string> {
  if (user.appAccountToken) return user.appAccountToken;
  await db
    .update(users)
    .set({ appAccountToken: crypto.randomUUID(), updatedAt: Date.now() })
    .where(and(eq(users.id, user.id), sql`${users.appAccountToken} is null`));
  // Whoever won a race, read the token that stuck.
  const row = await db
    .select({ token: users.appAccountToken })
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  if (!row?.token) throw new Error("appAccountToken wasn't stored");
  return row.token;
}

/** Whether sandbox purchases count for this athlete: on staging and locally; elsewhere only for some. */
function sandboxCounts(env: Env, userId: string): boolean {
  if (env.ENVIRONMENT === "staging" || env.ENVIRONMENT === "development") return true;
  return (env.APPLE_SANDBOX_USERS ?? "").split(",").some((id) => id.trim() === userId);
}

type Owner = {
  userId: string;
  /**
   * Whether the transaction carries this athlete's appAccountToken. Only then
   * can a newer purchase move the subscription to them, as when the same
   * Apple ID subscribes again while signed in to another Hop account.
   */
  byToken: boolean;
};

/**
 * Applies a signed transaction (and renewal info, from a notification) to a
 * subscription. Only newer data is applied: a later purchase, or the same
 * purchase signed later. So retries, out-of-order notifications and freshly
 * signed copies of superseded transactions can't roll it back.
 */
async function apply(
  env: Env,
  db: Db,
  owner: Owner,
  transaction: AppleTransaction,
  renewal?: AppleRenewalInfo,
) {
  if (transaction.bundleId !== env.APPLE_BUNDLE_ID) {
    throw new SubscriptionError("wrong_app", "That purchase is for another app.");
  }
  if (
    !(HOP_PLUS_PRODUCT_IDS as readonly string[]).includes(transaction.productId) ||
    transaction.type !== "Auto-Renewable Subscription" ||
    typeof transaction.purchaseDate !== "number" ||
    typeof transaction.expiresDate !== "number"
  ) {
    throw new SubscriptionError("unknown_product", "That isn't a Hop+ subscription.");
  }
  // Both: App Review and TestFlight buy in the sandbox against production.
  const environment = transaction.environment;
  if (environment !== "Sandbox" && environment !== "Production") {
    throw new SubscriptionError("wrong_environment", "That purchase can't be used here.");
  }
  if (environment === "Sandbox" && !sandboxCounts(env, owner.userId)) {
    throw new SubscriptionError("test_purchase", "Purchases in test builds don't unlock Hop+.");
  }
  if (renewal && renewal.originalTransactionId !== transaction.originalTransactionId) {
    throw new SubscriptionError("mismatch", "That renewal is for another subscription.");
  }
  // Superseded by the upgrade's own transaction, which is what counts.
  if (transaction.isUpgraded) return;

  const now = Date.now();
  const purchasedAt = transaction.purchaseDate;
  const signedAt = transaction.signedDate;
  const revokedAt = transaction.revocationDate ?? null;
  // Sandbox and production purchases never stand in for each other, nor
  // App Store ones for the website's.
  const sameKind = and(
    eq(subscriptions.provider, "apple"),
    eq(subscriptions.environment, environment),
  );
  const newer = or(
    lt(subscriptions.purchasedAt, purchasedAt),
    and(eq(subscriptions.purchasedAt, purchasedAt), lte(subscriptions.signedAt, signedAt)),
  );
  const mayWrite = owner.byToken
    ? or(eq(subscriptions.userId, owner.userId), lt(subscriptions.purchasedAt, purchasedAt))
    : eq(subscriptions.userId, owner.userId);
  // Every account whose plan this may change gets a new revision, in the same
  // transaction: whoever has the subscription now, and its new owner.
  const revise = db
    .update(users)
    .set({ planRevision: sql`${users.planRevision} + 1` })
    .where(
      or(
        eq(users.id, owner.userId),
        sql`${users.id} = (select ${subscriptions.userId} from ${subscriptions}
          where ${subscriptions.originalTransactionId} = ${transaction.originalTransactionId})`,
      ),
    );
  const upsert = db
    .insert(subscriptions)
    .values({
      originalTransactionId: transaction.originalTransactionId,
      userId: owner.userId,
      provider: "apple",
      productId: transaction.productId,
      environment,
      expiresAt: transaction.expiresDate,
      revokedAt,
      purchasedAt,
      signedAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.originalTransactionId,
      set: {
        userId: owner.userId,
        productId: transaction.productId,
        expiresAt: transaction.expiresDate,
        revokedAt,
        // A newer purchase ends any grace period; renewal info may start another.
        graceExpiresAt: sql`case when ${subscriptions.purchasedAt} < ${purchasedAt}
          then null else ${subscriptions.graceExpiresAt} end`,
        purchasedAt,
        signedAt,
        updatedAt: now,
      },
      setWhere: and(newer, mayWrite, sameKind),
    });
  if (!renewal) {
    await db.batch([revise, upsert]);
    return;
  }

  // Renewal info (grace period, auto-renew) keeps its own clock. The app
  // syncing the transaction mustn't hold back a grace period that Apple
  // signed earlier but delivered later. It only applies alongside the current
  // purchase, though: an older one's grace period is over.
  const renewalUpdate = db
    .update(subscriptions)
    .set({
      graceExpiresAt: renewal.gracePeriodExpiresDate ?? null,
      autoRenew: renewal.autoRenewStatus === 1,
      renewalSignedAt: renewal.signedDate,
      updatedAt: now,
    })
    .where(
      and(
        eq(subscriptions.originalTransactionId, transaction.originalTransactionId),
        eq(subscriptions.userId, owner.userId),
        sameKind,
        lte(subscriptions.purchasedAt, purchasedAt),
        or(
          isNull(subscriptions.renewalSignedAt),
          lte(subscriptions.renewalSignedAt, renewal.signedDate),
        ),
      ),
    );
  await db.batch([revise, upsert, renewalUpdate]);
}

/**
 * Whether Stripe's customer portal has anything for the athlete: they've
 * had Hop+ from the website, so it holds their invoices and card, after
 * Hop+ ends too. Not for a checkout they left unpaid.
 */
async function hasWebBilling(
  env: Env,
  db: Db,
  userId: string,
  customer: string | null,
): Promise<boolean> {
  if (!customer || !stripeEnabled(env)) return false;
  const had = await db
    .select({ id: subscriptions.originalTransactionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.provider, "stripe")))
    .limit(1)
    .get();
  return had !== undefined;
}

export async function planStatus(env: Env, db: Db, user: UserRow): Promise<PlanStatus> {
  // Read first: everything read after it is at least this new.
  const fresh = await db
    .select({ revision: users.planRevision, customer: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  const revision = fresh?.revision ?? 0;
  const now = Date.now();
  const [subscription, used, token, webBilling] = await Promise.all([
    activeSubscription(db, user.id, now),
    db
      .select({ bytes: sql<number>`coalesce(sum(${files.size}), 0)` })
      .from(files)
      .where(and(eq(files.ownerId, user.id), eq(files.status, "complete")))
      .get(),
    appAccountToken(db, user),
    hasWebBilling(env, db, user.id, fresh?.customer ?? null),
  ]);
  const plan = subscription ? PLANS.plus : PLANS.free;
  return {
    plan: subscription ? "plus" : "free",
    storage: { usedBytes: used?.bytes ?? 0, limitBytes: plan.storageBytes },
    retentionDays: plan.retentionDays,
    subscription: subscription
      ? {
          provider: subscription.provider,
          productId: subscription.productId,
          expiresAt: subscription.expiresAt,
          graceExpiresAt:
            subscription.graceExpiresAt && subscription.graceExpiresAt > subscription.expiresAt
              ? subscription.graceExpiresAt
              : null,
          autoRenew: subscription.autoRenew,
          environment: subscription.environment,
        }
      : null,
    appAccountToken: token,
    webBilling,
    plans: PLANS,
    revision,
    expiring: subscription ? null : await expiring(db, user.id),
  };
}

const notificationSchema = z.object({ signedPayload: z.string().min(1).max(65_536) });

/** Apple's signed data is a few KiB; refuse much bigger bodies before parsing them. */
const limitBody = bodyLimit({
  maxSize: 128 * 1024,
  onError: (c) => fail(c, 413, "too_large"),
});

export const billingRoutes = new Hono<AppEnv>()
  /** The athlete's plan, storage and subscription. */
  .get("/me/plan", requireUser, async (c) => {
    return c.json(await planStatus(c.env, getDb(c.env.DB), currentUser(c)));
  })

  /**
   * The app sends each Hop+ transaction StoreKit gives it: after a purchase,
   * on restore, and as renewals arrive while it runs. It must carry this
   * athlete's appAccountToken, so a purchase can't be claimed by another
   * account.
   */
  .post(
    "/me/subscriptions/apple",
    requireUser,
    limitBody,
    validate("json", appleTransactionSchema),
    async (c) => {
      const db = getDb(c.env.DB);
      const user = currentUser(c);
      let transaction: AppleTransaction;
      try {
        transaction = await verifyAppleSigned<AppleTransaction>(c.req.valid("json").transaction);
      } catch (error) {
        if (error instanceof AppleSignatureError) {
          return fail(c, 400, "invalid_transaction", "That purchase couldn't be verified.");
        }
        throw error;
      }
      const token = await appAccountToken(db, user);
      const purchaseToken = transaction.appAccountToken?.toLowerCase();
      if (purchaseToken !== token.toLowerCase()) {
        // Deleting an account clears its token, so a purchase whose token no
        // account has belongs to a deleted one. Apple still bills it.
        const holder = purchaseToken
          ? await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.appAccountToken, purchaseToken))
              .get()
          : undefined;
        if (purchaseToken && !holder) {
          return fail(
            c,
            403,
            "deleted_account",
            "This Hop+ belongs to a Hop account that was deleted. Cancel it in your Apple Account’s subscriptions, then subscribe again here.",
          );
        }
        return fail(c, 403, "other_account", "This purchase belongs to another Hop account.");
      }
      try {
        await apply(c.env, db, { userId: user.id, byToken: true }, transaction);
      } catch (error) {
        if (!(error instanceof SubscriptionError)) throw error;
        return fail(c, error.code === "test_purchase" ? 403 : 400, error.code, error.message);
      }
      // Another account keeps a subscription it has a newer purchase for.
      const owner = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.originalTransactionId, transaction.originalTransactionId))
        .get();
      if (owner && owner.userId !== user.id) {
        return fail(c, 403, "other_account", "This purchase belongs to another Hop account.");
      }
      return c.json(await planStatus(c.env, db, { ...user, appAccountToken: token }));
    },
  )

  /**
   * App Store Server Notifications V2, set in App Store Connect: production
   * for onmyhop.com, sandbox for staging. Apple retries anything but a 200,
   * so data that verifies but doesn't concern Hop+ still gets one.
   */
  .post("/apple/notifications", limitBody, validate("json", notificationSchema), async (c) => {
    const db = getDb(c.env.DB);
    let notification: AppleNotification;
    let transaction: AppleTransaction | undefined;
    let renewal: AppleRenewalInfo | undefined;
    try {
      notification = await verifyAppleSigned<AppleNotification>(c.req.valid("json").signedPayload);
      const data = notification.data;
      if (data?.bundleId !== c.env.APPLE_BUNDLE_ID) return fail(c, 400, "wrong_app");
      if (data.environment === "Production" && String(data.appAppleId) !== c.env.APPLE_APP_ID) {
        return fail(c, 400, "wrong_app");
      }
      if (data.signedTransactionInfo) {
        transaction = await verifyAppleSigned<AppleTransaction>(data.signedTransactionInfo);
      }
      if (data.signedRenewalInfo) {
        renewal = await verifyAppleSigned<AppleRenewalInfo>(data.signedRenewalInfo);
      }
    } catch (error) {
      if (error instanceof AppleSignatureError) return fail(c, 400, "invalid_notification");
      throw error;
    }
    // TEST notifications, and types without a transaction, need nothing done.
    if (!transaction) return c.json({ ok: true });

    // Whose: the account whose token the purchase carries. Without a token,
    // it can only update the subscription for whoever already has it.
    let owner: Owner | undefined;
    if (transaction.appAccountToken) {
      const user = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.appAccountToken, transaction.appAccountToken.toLowerCase()))
        .get();
      if (user) owner = { userId: user.id, byToken: true };
    } else {
      const row = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.originalTransactionId, transaction.originalTransactionId))
        .get();
      if (row) owner = { userId: row.userId, byToken: false };
    }
    if (!owner) {
      console.warn(
        "apple: notification for a subscription no account has",
        notification.notificationType,
      );
      return c.json({ ok: true });
    }
    try {
      await apply(c.env, db, owner, transaction, renewal);
    } catch (error) {
      if (!(error instanceof SubscriptionError)) throw error;
      console.warn("apple: notification ignored", notification.notificationType, error.code);
    }
    return c.json({ ok: true });
  });
