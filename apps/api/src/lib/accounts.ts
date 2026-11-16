import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import {
  blockKeys,
  blocks,
  devices,
  files,
  hops,
  liveActivities,
  reports,
  sessions,
  subscriptions,
  users,
  waitlist,
} from "../db/schema";
import { goneStatus } from "./files";

/**
 * Deleting an account.
 *
 * The row stays as a tombstone. Everything that identifies the athlete is
 * cleared at once (name, email, photo, sign-ins, subscriptions, Live
 * Activities), leaving the id, the handle, the colour and timestamps. A
 * handle that went back to the pool could be claimed by someone else, who
 * would then receive the clips people send to the old link or QR code.
 *
 * Their hops close, and their clips are marked for removal, which the hourly
 * cleanup does in batches (cron.ts), along with the emptied hops.
 *
 * Sessions of deleted accounts are refused (lib/session.ts), but a request
 * already under way when they delete it (saving a name, uploading a photo,
 * sending someone a clip, starting a Live Activity) can still write to the
 * tombstone afterwards. So the cleanup erases recently deleted accounts
 * again, for RECENT_MS: far longer than any request runs.
 */

/** How long after a deletion the cleanup keeps erasing the account again. */
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

/** SQL: a sender's name if it's an @handle (kept reserved anyway), else null. */
const keepHandle = (column: AnySQLiteColumn) =>
  sql<string | null>`case when ${column} like '@%' then ${column} else null end`;

/** Matches rows belonging to the accounts being erased. */
type Owned = (column: AnySQLiteColumn) => SQL;

/** One account, being deleted now. */
export const ownedBy =
  (userId: string): Owned =>
  (column) =>
    eq(column, userId);

/**
 * Every deleted account. Read through the partial index on deleted_at, and
 * each matched by an indexed owner column, so it stays cheap as they add up.
 */
export const ownedByDeleted =
  (db: Db): Owned =>
  (column) =>
    inArray(column, db.select({ id: users.id }).from(users).where(isNotNull(users.deletedAt)));

/** Accounts deleted in the last RECENT_MS, for the cleanup's catch-all. */
export const ownedByRecentlyDeleted =
  (db: Db, now: number): Owned =>
  (column) =>
    inArray(
      column,
      db
        .select({ id: users.id })
        .from(users)
        .where(gt(users.deletedAt, now - RECENT_MS)),
    );

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
    // Clips they sent other athletes stay with those athletes, no longer
    // tied to an account. A handle stays (it's kept reserved anyway); a name,
    // which is their real one if they had no handle, goes.
    db
      .update(files)
      .set({
        contributorUserId: null,
        contributorName: keepHandle(files.contributorName),
      })
      .where(owned(files.contributorUserId)),
    // Who they blocked, and that they made the reports they made. The
    // reports themselves stay, as the record of what was reported.
    db.delete(blockKeys).where(owned(blockKeys.ownerId)),
    db.delete(blocks).where(owned(blocks.ownerId)),
    db.update(reports).set({ reporterId: null }).where(owned(reports.reporterId)),
    // Where they're the sender someone blocked or reported, a name goes as on
    // clips (above); an @handle stays.
    db
      .update(blocks)
      .set({ label: keepHandle(blocks.label) })
      .where(owned(blocks.contributorUserId)),
    db
      .update(reports)
      .set({ contributorName: keepHandle(reports.contributorName) })
      .where(and(owned(reports.subjectUserId), ne(reports.kind, "profile"))),
    db.delete(sessions).where(owned(sessions.userId)),
    db.delete(liveActivities).where(owned(liveActivities.userId)),
    db.delete(devices).where(owned(devices.userId)),
    db.delete(subscriptions).where(owned(subscriptions.userId)),
    db
      .update(hops)
      .set({ status: "closed" })
      .where(and(owned(hops.ownerId), eq(hops.status, "open"))),
    // Due at once: the cleanup removes "deleting" clips idle for ten minutes.
    // A reported clip is held for Hop's team first (see lib/files.ts).
    db
      .update(files)
      .set({ status: goneStatus(now), lastActivityAt: 0 })
      .where(and(owned(files.ownerId), notInArray(files.status, ["deleting", "held"]))),
  ] as const;
}

/**
 * Deletes the account: marks it and erases it, in one batch. Returns the
 * account as it was, for the confirmation email and the photo; null if it
 * was already deleted.
 */
export async function deleteAccount(db: Db, userId: string, now = Date.now()) {
  const live = and(eq(users.id, userId), isNull(users.deletedAt));
  const [before] = await db.batch([
    db.select().from(users).where(live),
    // The launch waitlist is a separate sign-up, but someone deleting their
    // account doesn't want the launch email either. Verified addresses only:
    // an account can carry an address its owner never proved is theirs.
    db.delete(waitlist).where(
      inArray(
        waitlist.email,
        db
          .select({ email: sql<string>`lower(trim(${users.email}))` })
          .from(users)
          .where(and(live, eq(users.emailVerified, true))),
      ),
    ),
    db
      .update(users)
      // A new sign-in with the same Caliplaces account starts a new account.
      .set({ deletedAt: now, oidcSub: `deleted:${userId}`, updatedAt: now })
      .where(live),
    ...erasure(db, ownedBy(userId), now),
  ]);
  return before[0] ?? null;
}

/** The cleanup's first part: erases recently deleted accounts again (see above). */
export async function eraseDeletedAccounts(db: Db, now = Date.now()): Promise<void> {
  await db.batch(erasure(db, ownedByRecentlyDeleted(db, now), now));
}

/**
 * The cleanup's last part, once it has removed clips: drops deleted accounts'
 * hops that have none left, however long ago they were deleted, since clips
 * that failed to go for a while still go eventually. Returns how many went.
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
