import { and, eq, inArray, isNotNull, isNull, ne, notExists, or, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import { files, hops, liveActivities, sessions, subscriptions, users } from "../db/schema";

/**
 * Deleting an account.
 *
 * The row stays as a tombstone. Everything that identifies the athlete is
 * cleared at once (name, email, photo, sign-ins, subscriptions, Live
 * Activities), and only the id and handle remain. A handle that went back to
 * the pool could be claimed by someone else, who would then receive the clips
 * people send to the old link or QR code.
 *
 * Their hops close, and their clips are marked for removal, which the hourly
 * cleanup does in batches (cron.ts), along with the emptied hops.
 *
 * The cleanup also re-applies the erasure to every tombstone, so a request
 * that was already under way when they deleted the account (saving a name,
 * a photo upload, a Live Activity) can't leave anything behind for long.
 */

/** Matches rows belonging to the accounts being erased. */
type Owned = (column: AnySQLiteColumn) => SQL;

/** One account, being deleted now. */
export const ownedBy =
  (userId: string): Owned =>
  (column) =>
    eq(column, userId);

/** Every deleted account, for the cleanup's catch-all. */
export const ownedByDeleted =
  (db: Db): Owned =>
  (column) =>
    inArray(column, db.select({ id: users.id }).from(users).where(isNotNull(users.deletedAt)));

/**
 * Statements that erase the matching tombstones: run in one batch with the
 * deletion itself, and by the cleanup. Each only touches rows that still
 * need it, so running them again changes nothing.
 */
export function erasure(db: Db, owned: Owned, now: number) {
  return [
    db
      .update(users)
      .set({
        email: null,
        emailVerified: false,
        name: null,
        displayName: null,
        avatarKey: null,
        activeHopId: null,
        appAccountToken: null,
        emailNewClips: false,
        profileReviewedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          owned(users.id),
          isNotNull(users.deletedAt),
          or(
            isNotNull(users.email),
            isNotNull(users.name),
            isNotNull(users.displayName),
            isNotNull(users.avatarKey),
            isNotNull(users.activeHopId),
            isNotNull(users.appAccountToken),
            isNotNull(users.profileReviewedAt),
            eq(users.emailNewClips, true),
          ),
        ),
      ),
    db.delete(sessions).where(owned(sessions.userId)),
    db.delete(liveActivities).where(owned(liveActivities.userId)),
    db.delete(subscriptions).where(owned(subscriptions.userId)),
    db
      .update(hops)
      .set({ status: "closed" })
      .where(and(owned(hops.ownerId), eq(hops.status, "open"))),
    // Due at once: the cleanup removes "deleting" clips idle for ten minutes.
    db
      .update(files)
      .set({ status: "deleting", lastActivityAt: 0 })
      .where(and(owned(files.ownerId), ne(files.status, "deleting"))),
  ] as const;
}

/**
 * Deletes the account: marks it, erases it and lets go of the clips it sent
 * to others, in one batch. Returns the account as it was, for the
 * confirmation email and the photo; null if it was already deleted.
 */
export async function deleteAccount(db: Db, userId: string, now = Date.now()) {
  const [before] = await db.batch([
    db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt))),
    db
      .update(users)
      // A new sign-in with the same Caliplaces account starts a new account.
      .set({ deletedAt: now, oidcSub: `deleted:${userId}`, updatedAt: now })
      .where(and(eq(users.id, userId), isNull(users.deletedAt))),
    // Clips they sent to others stay with those athletes, no longer tied to
    // an account (and so no longer shown as from a signed-in contributor).
    db.update(files).set({ contributorUserId: null }).where(eq(files.contributorUserId, userId)),
    ...erasure(db, ownedBy(userId), now),
  ]);
  return before[0] ?? null;
}

/** The cleanup's first part: erases every tombstone again (see above). */
export async function eraseDeletedAccounts(db: Db, now = Date.now()): Promise<void> {
  await db.batch(erasure(db, ownedByDeleted(db), now));
}

/**
 * The cleanup's last part, once it has removed clips: drops deleted
 * accounts' hops that have none left. Returns how many went.
 */
export async function dropEmptiedHops(db: Db): Promise<number> {
  const emptied = await db
    .delete(hops)
    .where(
      and(
        ownedByDeleted(db)(hops.ownerId),
        notExists(db.select({ id: files.id }).from(files).where(eq(files.hopId, hops.id))),
      ),
    )
    .returning({ id: hops.id });
  return emptied.length;
}
