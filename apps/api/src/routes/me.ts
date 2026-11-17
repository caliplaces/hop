import {
  checkHandle,
  claimHandleSchema,
  createHopSchema,
  DEFAULT_HOP_SLUG,
  DEFAULT_HOP_TITLE,
  fileUrlsSchema,
  HOP_SLUG_PATTERN,
  type HopActivation,
  type HopArrivals,
  type HopSummary,
  type InboxFile,
  type InboxPage,
  isOffensive,
  MAX_AVATAR_BYTES,
  normalizeHandle,
  slugify,
  updateHopSchema,
  updateProfileSchema,
} from "@hop/shared";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type Db, getDb } from "../db";
import { type FileRow, files, hops, users } from "../db/schema";
import { sendAccountDeletedEmail } from "../email/account-deleted";
import { isSuppressed } from "../email/suppressions";
import { sendWelcomeEmail } from "../email/welcome";
import type { AppEnv, Env } from "../env";
import { deleteAccount } from "../lib/accounts";
import { arrivalsSince } from "../lib/arrivals";
import { AVATAR_CACHE, AVATAR_PREFIX, newAvatarKey } from "../lib/avatars";
import { newId } from "../lib/crypto";
import { removeFile } from "../lib/files";
import { BodyTooLargeError, fail, readBodyCapped } from "../lib/http";
import { sanitizeJpeg } from "../lib/jpeg";
import { hasPlus } from "../lib/plans";
import { currentUser, destroySession, requireUser } from "../lib/session";
import { presignGet } from "../lib/storage";
import { cancelForDeletion, lockCheckout, stripeEnabled, unlockCheckout } from "../lib/stripe";
import { validate } from "../lib/validate";
import { findUserByHandle, toMe } from "./auth";

const PAGE_SIZE = 60;
/** Arrivals name the senders of this many of the newest clips. */
const ARRIVALS_LATEST = 10;

function toInboxFile(f: FileRow): InboxFile {
  return {
    id: f.id,
    hopId: f.hopId,
    name: f.originalName,
    mime: f.mime,
    size: f.size,
    hasThumbnail: Boolean(f.thumbKey),
    contributorName: f.contributorName,
    contributorVerified: f.contributorUserId !== null,
    note: f.note,
    createdAt: f.createdAt,
  };
}

/** An event's name or link with a word Hop doesn't allow; athletes aren't told which. */
const nameUnavailable = (c: Context) =>
  fail(c, 400, "name_unavailable", "That name isn't available. Pick another.");

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed/i.test(`${error.message} ${error.cause ?? ""}`)
  );
}

export const meRoutes = new Hono<AppEnv>()
  /** Returns { me: null } when signed out so the web app can branch without a 401. */
  .get("/me", async (c) => {
    const user = c.get("user");
    const hopPlus = user ? await hasPlus(getDb(c.env.DB), user.id) : false;
    return c.json({ me: toMe(user, { hopPlus }) });
  })

  .get("/handles/:handle", async (c) => {
    const handle = normalizeHandle(c.req.param("handle"));
    const problem = checkHandle(handle);
    if (problem) return c.json({ handle, available: false, problem });
    const taken = await findUserByHandle(getDb(c.env.DB), handle);
    return c.json({ handle, available: !taken, problem: taken ? "taken" : null });
  })

  .use("/me/*", requireUser)

  /** Claim the account's one handle and create its default "Inbox" hop. */
  .put("/me/handle", validate("json", claimHandleSchema), async (c) => {
    const user = currentUser(c);
    if (user.handle) return fail(c, 409, "handle_already_set", "Your handle is already set.");
    const input = c.req.valid("json");
    const handle = normalizeHandle(input.handle);
    const problem = checkHandle(handle);
    if (problem) {
      return fail(
        c,
        400,
        `handle_${problem}`,
        problem === "unavailable" ? "That handle isn't available." : "That handle can't be used.",
      );
    }

    const db = getDb(c.env.DB);
    const hopId = newId("hop");
    const now = Date.now();
    let claimedNow: { id: string }[];
    try {
      // Only an account that still has no handle, and isn't deleted: another
      // claim, or a deletion, may have landed since this request began. The
      // hop is only made if the claim was.
      [claimedNow] = await db.batch([
        db
          .update(users)
          .set({ handle, activeHopId: hopId, color: input.color ?? user.color, updatedAt: now })
          .where(and(eq(users.id, user.id), isNull(users.handle), isNull(users.deletedAt)))
          .returning({ id: users.id }),
        db.insert(hops).select(
          db
            .select({
              id: sql<string>`${hopId}`.as("id"),
              ownerId: users.id,
              slug: sql<string>`${DEFAULT_HOP_SLUG}`.as("slug"),
              title: sql<string>`${DEFAULT_HOP_TITLE}`.as("title"),
              status: sql<"open">`'open'`.as("status"),
              createdAt: sql<number>`${now}`.as("created_at"),
            })
            .from(users)
            .where(and(eq(users.id, user.id), eq(users.activeHopId, hopId))),
        ),
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) return fail(c, 409, "handle_taken", "That handle is taken.");
      throw error;
    }
    if (claimedNow.length === 0) {
      return fail(c, 409, "handle_already_set", "Your handle is already set.");
    }
    const claimed = { ...user, handle, activeHopId: hopId, color: input.color ?? user.color };
    // After the response: a slow or failing email never holds up claiming a handle.
    c.executionCtx.waitUntil(
      sendWelcomeEmail(c.env, claimed).catch((error) =>
        console.error("Welcome email failed", error),
      ),
    );
    return c.json({ me: toMe(claimed, { hopPlus: await hasPlus(db, user.id) }) });
  })

  /** Profile settings: page colour, email preferences and the public profile. */
  .patch("/me", requireUser, validate("json", updateProfileSchema), async (c) => {
    const user = currentUser(c);
    if (await tooManyProfileChanges(c.env, user.id)) {
      return fail(c, 429, "rate_limited", "Too many changes. Try again in a minute.");
    }
    const db = getDb(c.env.DB);
    const { profileReviewed, ...changes } = c.req.valid("json");
    const now = Date.now();
    const set = {
      ...changes,
      ...(profileReviewed ? { profileReviewedAt: now } : {}),
      updatedAt: now,
    };
    // The row as saved, so changes made meanwhile (another device) show too.
    const saved = await db.update(users).set(set).where(eq(users.id, user.id)).returning().get();
    return c.json({
      me: toMe(saved ?? { ...user, ...set }, { hopPlus: await hasPlus(db, user.id) }),
    });
  })

  /**
   * Deletes the account, for good. Everything that identifies them goes at
   * once and they're signed out everywhere; their clips are removed within
   * the hour. The handle stays reserved. See lib/accounts.ts.
   */
  .delete("/me", requireUser, async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    // No checkout may open meanwhile, and the Stripe customer is read only
    // once it can't: one opening just now may have made it.
    const lockedAt = Date.now();
    if (!(await lockCheckout(db, user.id, lockedAt))) {
      return fail(c, 409, "checkout_opening", "Checkout is opening. Try again in a moment.");
    }
    const customer = (
      await db.select({ id: users.stripeCustomerId }).from(users).where(eq(users.id, user.id)).get()
    )?.id;
    let cancelledWebHopPlus = false;
    if (customer) {
      // Hop+ from the website: nothing would stop Stripe billing a deleted
      // account, so the account stays until it's cancelled.
      try {
        if (!stripeEnabled(c.env)) throw new Error("Stripe isn't set up");
        cancelledWebHopPlus = (await cancelForDeletion(c.env, customer)) > 0;
      } catch (error) {
        console.error("stripe: cancelling for deletion failed", error);
        await unlockCheckout(db, user.id, lockedAt);
        return fail(
          c,
          503,
          "billing_unavailable",
          "Couldn't cancel your Hop+ just now, so your account is still here. Try again in a minute.",
        );
      }
    }
    // Read before the account (and with it, its address's place on the
    // do-not-email list) goes: an address Hop doesn't email gets no word of
    // the deletion. Emailing it would only bounce, and put it back on the list.
    const quiet = user.email ? await isSuppressed(db, user.email) : false;
    const was = await deleteAccount(db, user.id);
    if (was?.avatarKey) await removeAvatar(c.env, was.avatarKey);
    if (was && !quiet) {
      // After the response: a slow or failing email never holds it up.
      c.executionCtx.waitUntil(
        sendAccountDeletedEmail(c.env, was, { cancelledWebHopPlus }).catch((error) =>
          console.error("Account deleted email failed", error),
        ),
      );
    }
    await destroySession(c);
    return c.json({ ok: true });
  })

  /**
   * Sets the profile photo. It's public, so the server rebuilds it from only
   * what's needed to show it (lib/jpeg.ts): no location or other metadata,
   * nothing hidden after it, and no huge picture in a small file. It's
   * stored under a new random name; the old one is deleted.
   */
  .put("/me/avatar", async (c) => {
    const user = currentUser(c);
    if (await tooManyProfileChanges(c.env, user.id)) {
      return fail(c, 429, "rate_limited", "Too many changes. Try again in a minute.");
    }
    if (c.req.header("content-type") !== "image/jpeg") {
      return fail(c, 415, "unsupported_type", "A profile photo must be a JPEG.");
    }
    let body: Uint8Array;
    try {
      body = await readBodyCapped(c.req.raw, MAX_AVATAR_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return fail(c, 413, "too_large", "That photo is too large.");
      }
      throw error;
    }
    const photo = sanitizeJpeg(body);
    if (!photo) {
      return fail(c, 415, "unsupported_type", "That photo can't be used. Try another.");
    }
    const db = getDb(c.env.DB);
    const key = newAvatarKey();
    await c.env.BUCKET.put(key, photo, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: AVATAR_CACHE },
    });
    const now = Date.now();
    const previous = await swapAvatar(db, user.id, key, now);
    if (previous) await removeAvatar(c.env, previous);
    return c.json({
      me: toMe(
        { ...user, avatarKey: key, updatedAt: now },
        { hopPlus: await hasPlus(db, user.id) },
      ),
    });
  })

  /** Removes the profile photo, so their initial shows instead. */
  .delete("/me/avatar", async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    const now = Date.now();
    const previous = await swapAvatar(db, user.id, null, now);
    if (previous) await removeAvatar(c.env, previous);
    return c.json({
      me: toMe(
        { ...user, avatarKey: null, updatedAt: now },
        { hopPlus: await hasPlus(db, user.id) },
      ),
    });
  })

  .get("/me/hops", async (c) => {
    const user = currentUser(c);
    const rows = await getDb(c.env.DB)
      .select({
        id: hops.id,
        slug: hops.slug,
        title: hops.title,
        status: hops.status,
        createdAt: hops.createdAt,
        fileCount: sql<number>`count(${files.id})`,
        totalBytes: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(hops)
      .leftJoin(files, and(eq(files.hopId, hops.id), eq(files.status, "complete")))
      .where(eq(hops.ownerId, user.id))
      .groupBy(hops.id)
      .orderBy(desc(hops.createdAt));
    return c.json({ hops: rows satisfies HopSummary[] });
  })

  .post("/me/hops", validate("json", createHopSchema), async (c) => {
    const user = currentUser(c);
    if (!user.handle) return fail(c, 409, "handle_required", "Pick your handle first.");
    const input = c.req.valid("json");
    const slug = slugify(input.slug || input.title);
    if (!HOP_SLUG_PATTERN.test(slug))
      return fail(c, 400, "invalid_slug", "Pick a different link name.");
    // Both are public: the link, and the name on the upload page.
    if (isOffensive(slug) || isOffensive(input.title)) return nameUnavailable(c);

    const hop = {
      id: newId("hop"),
      ownerId: user.id,
      slug,
      title: input.title,
      createdAt: Date.now(),
    };
    try {
      await getDb(c.env.DB).insert(hops).values(hop);
    } catch (error) {
      if (isUniqueViolation(error))
        return fail(c, 409, "slug_taken", "You already have a Hop with that link.");
      throw error;
    }
    return c.json(
      { hop: { ...hop, status: "open", fileCount: 0, totalBytes: 0 } satisfies HopSummary },
      201,
    );
  })

  .patch("/me/hops/:hopId", validate("json", updateHopSchema), async (c) => {
    const user = currentUser(c);
    const changes = c.req.valid("json");
    if (Object.keys(changes).length === 0)
      return fail(c, 400, "invalid_request", "Nothing to update.");
    if (changes.title !== undefined && isOffensive(changes.title)) return nameUnavailable(c);
    const updated = await getDb(c.env.DB)
      .update(hops)
      .set(changes)
      .where(and(eq(hops.id, c.req.param("hopId")), eq(hops.ownerId, user.id)))
      .returning()
      .get();
    if (!updated) return fail(c, 404, "not_found");
    return c.json({ ok: true });
  })

  /**
   * Point onmyhop.com/<handle> at this hop. Replies with when, by the server's
   * clock, so Event mode can count the clips that arrive from then on.
   */
  .post("/me/hops/:hopId/activate", async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    const hop = await db
      .select({ id: hops.id })
      .from(hops)
      .where(and(eq(hops.id, c.req.param("hopId")), eq(hops.ownerId, user.id)))
      .get();
    if (!hop) return fail(c, 404, "not_found");
    const now = Date.now();
    await db
      .update(users)
      .set({ activeHopId: hop.id, updatedAt: now })
      .where(eq(users.id, user.id));
    return c.json({ ok: true, activatedAt: now } satisfies HopActivation);
  })

  /**
   * Clips that finished uploading into a hop since `since` (milliseconds, by
   * the server's clock): how many, and the newest few. Counting by completion
   * means an upload started earlier still counts when it lands, and deleting
   * older clips changes nothing.
   */
  .get(
    "/me/hops/:hopId/arrivals",
    validate("query", z.object({ since: z.coerce.number().int().nonnegative() })),
    async (c) => {
      const user = currentUser(c);
      const db = getDb(c.env.DB);
      const hop = await db
        .select({ id: hops.id })
        .from(hops)
        .where(and(eq(hops.id, c.req.param("hopId")), eq(hops.ownerId, user.id)))
        .get();
      if (!hop) return fail(c, 404, "not_found");
      const { count, latest } = await arrivalsSince(
        db,
        hop.id,
        c.req.valid("query").since,
        ARRIVALS_LATEST,
      );
      return c.json({ count, latest: latest.map(toInboxFile) } satisfies HopArrivals);
    },
  )

  .get(
    "/me/files",
    validate(
      "query",
      z.object({
        hopId: z.string().optional(),
        cursor: z.string().optional(),
        /** Fewer than a page, such as an event card's cover. */
        limit: z.coerce.number().int().min(1).max(PAGE_SIZE).optional(),
      }),
    ),
    async (c) => {
      const user = currentUser(c);
      const { hopId, cursor, limit = PAGE_SIZE } = c.req.valid("query");
      const conditions = [eq(files.ownerId, user.id), eq(files.status, "complete")];
      if (hopId) conditions.push(eq(files.hopId, hopId));
      if (cursor) {
        const [at, id] = cursor.split(":");
        const createdAt = Number(at);
        if (!id || !Number.isFinite(createdAt)) return fail(c, 400, "invalid_cursor");
        const before = or(
          lt(files.createdAt, createdAt),
          and(eq(files.createdAt, createdAt), lt(files.id, id)),
        );
        if (before) conditions.push(before);
      }
      const rows = await getDb(c.env.DB)
        .select()
        .from(files)
        .where(and(...conditions))
        .orderBy(desc(files.createdAt), desc(files.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const result: InboxPage = {
        files: page.map(toInboxFile),
        nextCursor: rows.length > limit && last ? `${last.createdAt}:${last.id}` : null,
      };
      return c.json(result);
    },
  )

  .get("/me/files/:fileId/url", async (c) => {
    const user = currentUser(c);
    const file = await getDb(c.env.DB)
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, c.req.param("fileId")),
          eq(files.ownerId, user.id),
          eq(files.status, "complete"),
        ),
      )
      .get();
    if (!file) return fail(c, 404, "not_found");
    const url = await presignGet(c.env, file.r2Key, {
      filename: file.originalName,
      mime: file.mime,
      download: c.req.query("download") === "1",
    });
    return c.json({ url });
  })

  /** Signed download links for many files at once (used where zipping isn't possible). */
  .post("/me/files/urls", validate("json", fileUrlsSchema), async (c) => {
    const user = currentUser(c);
    const { ids, download } = c.req.valid("json");
    const rows = await getDb(c.env.DB)
      .select()
      .from(files)
      .where(and(inArray(files.id, ids), eq(files.ownerId, user.id), eq(files.status, "complete")));
    const urls = await Promise.all(
      rows.map(async (f) => ({
        id: f.id,
        url: await presignGet(c.env, f.r2Key, { filename: f.originalName, mime: f.mime, download }),
      })),
    );
    return c.json({ urls });
  })

  .get("/me/files/:fileId/thumbnail", async (c) => {
    const user = currentUser(c);
    const file = await getDb(c.env.DB)
      .select({ thumbKey: files.thumbKey })
      .from(files)
      .where(and(eq(files.id, c.req.param("fileId")), eq(files.ownerId, user.id)))
      .get();
    if (!file?.thumbKey) return fail(c, 404, "not_found");
    const object = await c.env.BUCKET.get(file.thumbKey);
    if (!object) return fail(c, 404, "not_found");
    return new Response(object.body, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=86400, immutable",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  })

  .delete("/me/files/:fileId", async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, c.req.param("fileId")), eq(files.ownerId, user.id)))
      .get();
    if (!file) return fail(c, 404, "not_found");
    await removeFile(c.env, db, file);
    return c.json({ ok: true });
  });

/**
 * Puts `key` (or none) in place of the account's photo, in one transaction,
 * and returns the one it replaced. Overlapping uploads each get the photo
 * they replaced, so none is left behind.
 */
async function swapAvatar(db: Db, userId: string, key: string | null, now: number) {
  const [previous] = await db.batch([
    db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId)),
    db.update(users).set({ avatarKey: key, updatedAt: now }).where(eq(users.id, userId)),
  ]);
  return previous[0]?.key ?? null;
}

/**
 * Deletes a photo no longer in use, best effort: if R2 fails, the hourly
 * cleanup finds it unreferenced and deletes it then (see sweepAvatars).
 * Only ever a photo, whatever the key says.
 */
async function removeAvatar(env: Env, key: string): Promise<void> {
  if (!key.startsWith(AVATAR_PREFIX)) return;
  try {
    await env.BUCKET.delete(key);
  } catch (error) {
    console.warn("avatar: delete failed, cleanup will retry", error);
  }
}

/** Per account, so a script can't churn through photos and names. */
async function tooManyProfileChanges(env: Env, userId: string): Promise<boolean> {
  const { success } = await env.PROFILE_LIMITER.limit({ key: `profile:${userId}` });
  return !success;
}
