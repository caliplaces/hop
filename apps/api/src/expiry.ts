import { EXPIRY_NOTICE_DAYS, PLANS } from "@hop/shared";
import { and, count, eq, gt, inArray, isNotNull, isNull, lte, min, not, sql } from "drizzle-orm";
import { type Db, getDb } from "./db";
import { devices, files, users } from "./db/schema";
import { clipsExpiringEmail, clipsExpiringPush } from "./email/clips-expiring";
import { ResendError, sendEmail } from "./email/send";
import type { Env } from "./env";
import { pushAlert } from "./lib/apns";
import { goneStatus } from "./lib/files";
import { hasPlusSql } from "./lib/plans";

/**
 * Free-plan expiry. Free clips are kept for PLANS.free.retentionDays (30),
 * then removed for good, from R2 too. Before that the athlete hears, by email
 * and on their phone:
 *
 *   notice    a week ahead (EXPIRY_NOTICE_DAYS): "12 clips leave on …"
 *   reminder  the day before: "Tomorrow, 12 clips leave"
 *
 * A clip goes only once it's 30 days old and its notice went out at least a
 * week before, so none goes unannounced, including the old clips of someone
 * whose Hop+ just ended. Each athlete gets at most one notice and one
 * reminder a day, covering every clip due one. Hop+ clears all of it: a
 * later lapse starts over with a fresh notice.
 *
 * A notice is a batch claimed once (files.expiry_notice_batch) and sent with
 * that batch as its idempotency key, as the new-clips digest does; clips
 * count as noticed (expiry_noticed_at) only once it went. A notice that keeps
 * failing is let go after a day and claimed afresh, never assumed sent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = (PLANS.free.retentionDays ?? 30) * DAY_MS;
export const NOTICE_MS = EXPIRY_NOTICE_DAYS * DAY_MS;
/** A notice still unconfirmed this long after its claim; send it again. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** Resend remembers idempotency keys for a day: past that, claim afresh. */
const GIVE_UP_AFTER_MS = 23 * 60 * 60 * 1000;
/** Athletes handled per run; anyone left over goes next run. */
const PER_RUN = 25;

/** SQL: the clip's owner has no Hop+ right now. */
const ownerIsFree = (now: number) => not(hasPlusSql(files.ownerId, now));

/** SQL: when a noticed clip goes: 30 days old, and a week after its notice. */
export const goesAtSql = sql<number>`max(${files.completedAt} + ${RETENTION_MS}, ${files.expiryNoticedAt} + ${NOTICE_MS})`;

/**
 * Sends the notices and reminders due, and clears expiry for athletes who
 * have Hop+. Runs with the five-minute email jobs.
 */
export async function remindOfExpiry(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env.DB);
  await keepForHopPlus(db, now);
  const sent = (await sendNotices(env, db, now)) + (await sendReminders(env, db, now));
  if (sent > 0) console.log(`expiry: ${sent} notices and reminders sent`);
}

/** Hop+ keeps every clip: whatever notice its clips had no longer applies. */
async function keepForHopPlus(db: Db, now: number) {
  await db
    .update(files)
    .set({ expiryNoticeBatch: null, expiryNoticedAt: null, expiryRemindedAt: null })
    .where(and(gt(files.expiryNoticeBatch, 0), hasPlusSql(files.ownerId, now)));
}

async function sendNotices(env: Env, db: Db, now: number): Promise<number> {
  // Notices claimed but not confirmed: the same clips, under the same key.
  const stalled = await db
    .selectDistinct({ ownerId: files.ownerId, batch: files.expiryNoticeBatch })
    .from(files)
    .where(
      and(
        gt(files.expiryNoticeBatch, 0),
        lte(files.expiryNoticeBatch, now - RETRY_AFTER_MS),
        isNull(files.expiryNoticedAt),
      ),
    )
    .limit(PER_RUN);

  // Athletes with clips due a notice: old enough, not yet in one, with no
  // notice in the last day. Read athlete by athlete through files_unnoticed_idx.
  const dueBy = now - (RETENTION_MS - NOTICE_MS);
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        sql`exists (
          select 1 from ${files}
          where ${files.ownerId} = ${users.id}
            and ${files.status} = 'complete'
            and ${files.expiryNoticeBatch} is null
            and ${files.completedAt} <= ${dueBy}
        )`,
        sql`not exists (
          select 1 from ${files}
          where ${files.ownerId} = ${users.id}
            and ${files.expiryNoticeBatch} > ${now - DAY_MS}
        )`,
        not(hasPlusSql(users.id, now)),
      ),
    )
    .limit(PER_RUN);

  let sent = 0;
  for (const { ownerId, batch } of stalled) {
    if (batch !== null && (await sendNotice(env, db, ownerId, batch, now))) sent++;
  }
  for (const { id } of due) {
    // Claim atomically, so overlapping runs can't put a clip in two notices.
    const claimed = await db
      .update(files)
      .set({ expiryNoticeBatch: now })
      .where(
        and(
          eq(files.ownerId, id),
          eq(files.status, "complete"),
          isNull(files.expiryNoticeBatch),
          lte(files.completedAt, dueBy),
        ),
      )
      .returning({ id: files.id });
    if (claimed.length > 0 && (await sendNotice(env, db, id, now, now))) sent++;
  }
  return sent;
}

/** Sends one notice; true once it's gone (and its clips count as noticed). */
async function sendNotice(env: Env, db: Db, ownerId: string, batch: number, now: number) {
  const inBatch = and(eq(files.ownerId, ownerId), eq(files.expiryNoticeBatch, batch));
  if (now - batch > GIVE_UP_AFTER_MS) {
    // A day of failures: let these clips go back to be claimed afresh, under
    // a new key. They're never assumed noticed.
    console.error("expiry: notice failing for a day, claiming afresh", ownerId, batch);
    await db
      .update(files)
      .set({ expiryNoticeBatch: null })
      .where(and(inBatch, isNull(files.expiryNoticedAt)));
    return false;
  }
  const clips = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inBatch, eq(files.status, "complete")));
  // When they go: a week from now at the earliest (from when this goes out).
  const at = now + NOTICE_MS;
  try {
    if (clips.length > 0)
      await tell(env, db, ownerId, { clips: clips.length, at, when: "notice" }, batch);
  } catch (error) {
    console.error("expiry: notice failed, will retry", ownerId, batch, error);
    return false;
  }
  await db
    .update(files)
    .set({ expiryNoticedAt: now })
    .where(and(inBatch, isNull(files.expiryNoticedAt)));
  return clips.length > 0;
}

async function sendReminders(env: Env, db: Db, now: number): Promise<number> {
  // Noticed clips going within a day, not yet reminded, for athletes not
  // reminded in the last day. Best effort: the notice is what counts.
  const dueBy = now - (NOTICE_MS - DAY_MS);
  const due = await db
    .selectDistinct({ ownerId: files.ownerId })
    .from(files)
    .where(
      and(
        gt(files.expiryNoticeBatch, 0),
        lte(files.expiryNoticedAt, dueBy),
        isNull(files.expiryRemindedAt),
        eq(files.status, "complete"),
        ownerIsFree(now),
      ),
    )
    .limit(PER_RUN);
  let sent = 0;
  for (const { ownerId } of due) {
    const reminded = await db
      .update(files)
      .set({ expiryRemindedAt: now })
      .where(
        and(
          eq(files.ownerId, ownerId),
          gt(files.expiryNoticeBatch, 0),
          lte(files.expiryNoticedAt, dueBy),
          isNull(files.expiryRemindedAt),
          eq(files.status, "complete"),
        ),
      )
      .returning({ at: goesAtSql });
    if (reminded.length === 0) continue;
    const at = Math.min(...reminded.map((clip) => clip.at));
    try {
      await tell(env, db, ownerId, { clips: reminded.length, at, when: "reminder" }, now);
      sent++;
    } catch (error) {
      console.error("expiry: reminder failed", ownerId, error);
    }
  }
  return sent;
}

/**
 * Tells the athlete: by email to a verified address (whatever their new-clips
 * setting), and on every phone of theirs that took notifications. Throws if
 * the email didn't go; pushes are best effort.
 */
async function tell(
  env: Env,
  db: Db,
  ownerId: string,
  news: { clips: number; at: number; when: "notice" | "reminder" },
  batch: number,
) {
  const user = await db.select().from(users).where(eq(users.id, ownerId)).get();
  if (!user || user.deletedAt) return;

  if (env.APNS_KEY) {
    const phones = await db
      .select({ token: devices.token })
      .from(devices)
      .where(and(eq(devices.userId, ownerId), eq(devices.environment, env.APNS_ENVIRONMENT)));
    const alert = clipsExpiringPush(news);
    await Promise.all(
      phones.map(async ({ token }) => {
        const outcome = await pushAlert(env, token, alert, { hop: "expiring" }).catch((error) => {
          console.error("expiry: push failed", error);
          return "failed" as const;
        });
        if (outcome === "gone") await db.delete(devices).where(eq(devices.token, token));
      }),
    );
  }

  if (!user.email || !user.emailVerified) return;
  const email = await clipsExpiringEmail({ appUrl: env.APP_URL, ...news });
  try {
    await sendEmail(env, {
      ...email,
      to: user.email,
      idempotencyKey: `clips-expiring/${news.when}/${ownerId}/${batch}`,
      category: "clips-expiring",
    });
  } catch (error) {
    // This key already went with a different text (a clip deleted since):
    // the earlier email went out.
    if (!(error instanceof ResendError && error.code === "invalid_idempotent_request")) throw error;
  }
}

/**
 * The cleanup's part: free-plan clips that are 30 days old and were noticed a
 * week ago go, to be removed from R2 by the cleanup's loop (or hidden if held
 * for a report). Returns how many.
 */
export async function expireClips(db: Db, now = Date.now(), limit = 5000): Promise<number> {
  const due = db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        gt(files.expiryNoticeBatch, 0),
        isNotNull(files.expiryNoticedAt),
        lte(files.expiryNoticedAt, now - NOTICE_MS),
        lte(files.completedAt, now - RETENTION_MS),
        eq(files.status, "complete"),
        ownerIsFree(now),
      ),
    )
    .limit(limit);
  const gone = await db
    .update(files)
    .set({ status: goneStatus(now), lastActivityAt: 0 })
    .where(inArray(files.id, due))
    .returning({ id: files.id });
  return gone.length;
}

/** For the plan: the athlete's noticed clips, and when the first of them go. */
export async function expiring(db: Db, userId: string) {
  const row = await db
    .select({ clips: count(), at: min(goesAtSql) })
    .from(files)
    .where(
      and(
        eq(files.ownerId, userId),
        gt(files.expiryNoticeBatch, 0),
        isNotNull(files.expiryNoticedAt),
        eq(files.status, "complete"),
      ),
    )
    .get();
  return row && row.clips > 0 && row.at !== null ? { clips: row.clips, at: Number(row.at) } : null;
}
