import { PENDING_UPLOAD_TTL_MS } from "@hop/shared";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "./db";
import { files, liveActivities, reports, sessions, users, waitlist } from "./db/schema";
import type { Env } from "./env";
import { KEEP_SENT_MS, KEEP_UNSENT_MS } from "./launch";
import { dropEmptiedHops, eraseDeletedAccounts } from "./lib/accounts";
import { AVATAR_PREFIX } from "./lib/avatars";
import { finishRemoval } from "./lib/files";

const BATCH = 100;
/** How long a report is kept. */
const KEEP_REPORTS_MS = 365 * 24 * 60 * 60 * 1000;
/** Upper bound per run so one invocation stays well inside Worker limits. */
const MAX_BATCHES = 50;
/** A removal still "deleting" after this long failed midway and is retried. */
const STUCK_DELETE_MS = 10 * 60 * 1000;

/**
 * Removes uploads with no activity for a day, retries removals that failed
 * midway, finishes deleting accounts, and deletes expired sessions and Live
 * Activity registrations.
 */
export async function cleanup(env: Env) {
  const db = getDb(env.DB);
  let removed = 0;
  let failed = 0;

  // Erases recently deleted accounts again and marks their clips for removal,
  // which the loop below then does (see lib/accounts.ts). On its own, like
  // each step that isn't the loop: one failing mustn't stop the rest.
  await eraseDeletedAccounts(db).catch((error) =>
    console.error("cleanup: erasing deleted accounts failed, will retry", error),
  );

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const now = Date.now();
    const due = or(
      and(eq(files.status, "pending"), lt(files.lastActivityAt, now - PENDING_UPLOAD_TTL_MS)),
      and(eq(files.status, "deleting"), lt(files.lastActivityAt, now - STUCK_DELETE_MS)),
      // Deleted clips held for a report, once the hold is over.
      and(eq(files.status, "held"), lt(files.heldUntil, now)),
    );
    const candidates = await db.select({ id: files.id }).from(files).where(due).limit(BATCH);
    if (candidates.length === 0) break;

    const outcomes = await Promise.allSettled(
      candidates.map(async ({ id }) => {
        // Claim atomically. If the upload completed since it was read, the
        // conditions no longer match and it's left alone. Bumping the activity
        // time keeps a failing removal from being retried again in this run.
        const file = await db
          .update(files)
          .set({ status: "deleting", lastActivityAt: Date.now() })
          .where(and(eq(files.id, id), due))
          .returning()
          .get();
        if (!file) return false;
        await finishRemoval(env, db, file);
        return true;
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        failed++;
        console.error("cleanup: removal failed, will retry", outcome.reason);
      } else if (outcome.value) {
        removed++;
      }
    }
  }

  const hopsDropped = await dropEmptiedHops(db).catch((error) => {
    console.error("cleanup: dropping deleted accounts' hops failed, will retry", error);
    return 0;
  });
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  await db.delete(liveActivities).where(lt(liveActivities.expiresAt, Date.now()));
  // Reports are the record of what was reported, kept for a year.
  await db.delete(reports).where(lt(reports.createdAt, Date.now() - KEEP_REPORTS_MS));
  // The waitlist keeps an address only until a day after its launch email,
  // or a week after the first try if it never got through.
  await db
    .delete(waitlist)
    .where(
      or(
        lt(waitlist.notifiedAt, Date.now() - KEEP_SENT_MS),
        and(
          isNull(waitlist.notifiedAt),
          lt(waitlist.launchFirstAttemptAt, Date.now() - KEEP_UNSENT_MS),
        ),
      ),
    );
  // On its own: a failing sweep mustn't stop the rest of the cleanup.
  const avatars = await sweepAvatars(env).catch((error) => {
    console.error("cleanup: photo sweep failed, will retry", error);
    return 0;
  });
  console.log(
    `cleanup: removed ${removed} uploads, ${failed} failed, ${avatars} unused photos, ${hopsDropped} deleted accounts' hops`,
  );
}

/** An upload under way finishes long before this, so its photo is never swept. */
const AVATAR_GRACE_MS = 60 * 60 * 1000;
/** D1 takes at most 100 bound values a query. */
const KEYS_PER_QUERY = 90;

/**
 * Deletes profile photos no account points to: left by overlapping uploads,
 * or by a delete that failed. Only photos older than AVATAR_GRACE_MS, so one
 * being saved right now is left alone. Returns how many went.
 */
export async function sweepAvatars(env: Env, now = Date.now()): Promise<number> {
  const db = getDb(env.DB);
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: AVATAR_PREFIX, cursor, limit: 500 });
    const old = page.objects
      .filter((object) => object.uploaded.getTime() < now - AVATAR_GRACE_MS)
      .map((object) => object.key);
    for (let i = 0; i < old.length; i += KEYS_PER_QUERY) {
      const keys = old.slice(i, i + KEYS_PER_QUERY);
      const used = await db
        .select({ key: users.avatarKey })
        .from(users)
        .where(inArray(users.avatarKey, keys));
      const inUse = new Set(used.map((row) => row.key));
      const unused = keys.filter((key) => !inUse.has(key));
      if (unused.length > 0) {
        await env.BUCKET.delete(unused);
        removed += unused.length;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}
