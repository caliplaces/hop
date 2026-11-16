import { EXPIRY_NOTICE_DAYS, PLANS } from "@hop/shared";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  min,
  not,
  or,
  sql,
} from "drizzle-orm";
import { type Db, getDb } from "./db";
import {
  devices,
  type ExpiryNoticeRow,
  expiryNotices,
  files,
  type UserRow,
  users,
} from "./db/schema";
import { clipsExpiringEmail, clipsExpiringPush } from "./email/clips-expiring";
import { sendEmail } from "./email/send";
import type { Env } from "./env";
import { pushAlert } from "./lib/apns";
import { goneStatus } from "./lib/files";
import { hasPlusSql } from "./lib/plans";

/**
 * Free-plan expiry. Free clips are kept for PLANS.free.retentionDays (30),
 * then removed for good, from R2 too. Before that the athlete is told:
 *
 *   notice    a week ahead (EXPIRY_NOTICE_DAYS): "12 clips leave your inbox
 *             on Monday 23 November", by email, and on their phone if they
 *             turned notifications on
 *   reminder  the day before: "Last call: …", best effort
 *
 * A notice names a calendar day, the same wherever the athlete is, and its
 * clips stay until that day has ended everywhere (UTC−12): at least seven and
 * a half days after it was claimed. It counts only once it reached the
 * athlete: their verified address took the email, or, with no address, a
 * phone took the push. Until then its clips stay, however old. A notice that
 * can't get through is let go after GIVE_UP_AFTER_MS and claimed afresh the
 * next day, never assumed given.
 *
 * Each athlete gets at most one notice a day, covering every clip due one,
 * and at most one reminder a day. Hop+ clears all of it, and for a while
 * after it ends (LAPSE_MARGIN_MS) nothing is noticed, so a renewal Apple
 * hasn't told the API of yet can't cost a subscriber their clips.
 *
 * The state is in expiry_notices (one row per athlete and batch) and on each
 * clip: files.expiry_notice_batch (claimed into that notice) and
 * files.expiry_goes_at (set once the notice is given: when it may go).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = (PLANS.free.retentionDays ?? 30) * DAY_MS;
export const NOTICE_MS = EXPIRY_NOTICE_DAYS * DAY_MS;
/** A day ends last in UTC−12, 12 hours after it ends in UTC. */
const LAST_TIME_ZONE_MS = 12 * 60 * 60 * 1000;
/** A notice that didn't get through is tried again after this, then twice as long each time… */
const FIRST_RETRY_MS = 5 * 60 * 1000;
/** …up to this. */
const MAX_RETRY_MS = 60 * 60 * 1000;
/**
 * A notice not through this long after its claim is let go. Well inside the
 * day Resend remembers an idempotency key for, and early enough that the day
 * it names is still more than a week off.
 */
const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;
/** After Hop+ ends, nothing is noticed for this long (see above). */
export const LAPSE_MARGIN_MS = 30 * DAY_MS;
/** Reminders go once the clips are this close to going… */
const REMIND_FROM_MS = 2 * DAY_MS;
/** …and not this close: too late to help. */
const REMIND_UNTIL_MS = 60 * 60 * 1000;
/** At most one reminder within this long. */
const REMINDER_GAP_MS = 23 * 60 * 60 * 1000;
/** Athletes handled per run, for each of claiming, sending and reminding. */
const PER_RUN = 25;
/** Phones pushed to per athlete; registering keeps no more (routes/devices.ts). */
export const PHONES_PER_ATHLETE = 5;

/** The day a notice claimed at `batch` names: a week on, as midnight UTC. */
export function statedDay(batch: number): number {
  return Math.floor((batch + NOTICE_MS) / DAY_MS) * DAY_MS;
}

/** When clips named for `day` may go: once it has ended in every time zone. */
export function goesAt(day: number): number {
  return day + DAY_MS + LAST_TIME_ZONE_MS;
}

/** The day a notice named, from when its clips go. */
function dayOf(goes: number): number {
  return goes - DAY_MS - LAST_TIME_ZONE_MS;
}

/**
 * SQL: the clip is complete. The unary + keeps SQLite from reading it
 * through the status indexes (every clip) should D1's statistics ever favour
 * them; today's plans don't, but nothing promises that.
 */
const isComplete = sql`+${files.status} = 'complete'`;

/**
 * Claims, sends and reminds whatever is due, and clears expiry for athletes
 * with Hop+. Runs with the five-minute email jobs.
 */
export async function remindOfExpiry(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env.DB);
  await keepForHopPlus(db, now);
  await claimNotices(env, db, now);
  const given = await sendNotices(env, db, now);
  const reminded = await sendReminders(env, db, now);
  if (given + reminded > 0) console.log(`expiry: ${given} notices and ${reminded} reminders sent`);
}

/** Hop+ keeps every clip: whatever notice its clips had no longer applies. */
async function keepForHopPlus(db: Db, now: number) {
  const subscribed = db
    .select({ id: expiryNotices.userId })
    .from(expiryNotices)
    .where(hasPlusSql(expiryNotices.userId, now));
  await db.batch([
    db
      .update(files)
      .set({ expiryNoticeBatch: null, expiryGoesAt: null })
      .where(and(inArray(files.ownerId, subscribed), isNotNull(files.expiryNoticeBatch))),
    db.delete(expiryNotices).where(hasPlusSql(expiryNotices.userId, now)),
  ]);
}

/**
 * Claims a notice for each athlete with clips due one: free (and not lately
 * Hop+), someone Hop can tell, and not noticed in the last day. Each claim
 * takes all their due clips at once, atomically, so overlapping runs can't
 * put a clip in two notices.
 */
async function claimNotices(env: Env, db: Db, now: number) {
  const dueBy = now - (RETENTION_MS - NOTICE_MS);
  const hasAddressSql = and(isNotNull(users.email), eq(users.emailVerified, true));
  const reachable = env.APNS_KEY
    ? or(
        hasAddressSql,
        sql`exists (
          select 1 from ${devices}
          where ${devices.userId} = ${users.id} and ${devices.environment} = ${env.APNS_ENVIRONMENT}
        )`,
      )
    : hasAddressSql;
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        // First: cheap, and rules out whole Hop+ libraries.
        not(hasPlusSql(users.id, now - LAPSE_MARGIN_MS)),
        reachable,
        sql`not exists (
          select 1 from ${expiryNotices}
          where ${expiryNotices.userId} = ${users.id}
            and (${expiryNotices.batch} > ${now - DAY_MS} or ${expiryNotices.givenAt} > ${now - DAY_MS})
        )`,
        // Read through files_unnoticed_idx.
        sql`exists (
          select 1 from ${files}
          where ${files.ownerId} = ${users.id}
            and ${files.status} = 'complete'
            and ${files.expiryNoticeBatch} is null
            and ${files.completedAt} <= ${dueBy}
        )`,
      ),
    )
    .limit(PER_RUN);

  for (const { id } of due) {
    const unnoticed = and(
      eq(files.ownerId, id),
      sql`${files.status} = 'complete'`,
      isNull(files.expiryNoticeBatch),
      lte(files.completedAt, dueBy),
    );
    // In one transaction: the notice, naming as many clips as it then claims.
    // No row when there are none (another run got them).
    await db.batch([
      db.insert(expiryNotices).select(sql`
        select ${files.ownerId}, ${now}, count(*), ${goesAt(statedDay(now))}, 0, ${now},
          null, null, null, null
        from ${files} where ${unnoticed} group by ${files.ownerId}
      `),
      db.update(files).set({ expiryNoticeBatch: now }).where(unnoticed),
    ]);
  }
}

/** Sends the notices due a try, longest waiting first. Returns how many got through. */
async function sendNotices(env: Env, db: Db, now: number): Promise<number> {
  const sending = await db
    .select()
    .from(expiryNotices)
    .where(
      and(
        isNull(expiryNotices.givenAt),
        isNull(expiryNotices.abandonedAt),
        lte(expiryNotices.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(expiryNotices.nextAttemptAt))
    .limit(PER_RUN);
  let given = 0;
  for (const notice of sending) {
    try {
      if (await sendNotice(env, db, notice, now)) given++;
    } catch (error) {
      console.error("expiry: notice failed, will retry", notice.userId, notice.batch, error);
    }
  }
  return given;
}

/** One try at a notice; true once it has reached the athlete. */
async function sendNotice(env: Env, db: Db, notice: ExpiryNoticeRow, now: number) {
  const ofNotice = and(
    eq(expiryNotices.userId, notice.userId),
    eq(expiryNotices.batch, notice.batch),
  );
  const inNotice = and(eq(files.ownerId, notice.userId), eq(files.expiryNoticeBatch, notice.batch));
  const letGo = () =>
    db.batch([
      db.update(expiryNotices).set({ abandonedAt: now }).where(ofNotice),
      db.update(files).set({ expiryNoticeBatch: null }).where(inNotice),
    ]);

  const user = await db.select().from(users).where(eq(users.id, notice.userId)).get();
  const left = await db
    .select({ clips: count() })
    .from(files)
    .where(and(inNotice, isComplete))
    .get();
  if (!user || user.deletedAt || !left?.clips) {
    // Nobody to tell, or nothing left to tell them of.
    await letGo();
    return false;
  }
  if (now - notice.batch > GIVE_UP_AFTER_MS) {
    // Its clips stay, and are claimed afresh tomorrow under a new key.
    console.error("expiry: notice didn't get through, letting it go", notice.userId, notice.batch);
    await letGo();
    return false;
  }

  // As claimed, so a retry sends the very same email under the same key.
  const news = { clips: notice.clips, day: dayOf(notice.goesAt), when: "notice" as const };
  const collapseId = `expiring-${notice.batch}`;
  // Pushed once, whatever happens to the email.
  const pushedAt =
    notice.pushedAt ?? ((await push(env, db, user.id, news, collapseId, now)) ? now : null);
  // By email when they have a verified address: a push can be silenced in
  // Settings and still be taken. Otherwise the phone is all there is.
  const reached = hasAddress(user)
    ? await email(env, user, news, `clips-expiring/notice/${user.id}/${notice.batch}`)
    : pushedAt !== null;

  if (reached) {
    await db.batch([
      db
        .update(expiryNotices)
        .set({ givenAt: now, pushedAt, attempts: notice.attempts + 1 })
        .where(ofNotice),
      db.update(files).set({ expiryGoesAt: notice.goesAt }).where(inNotice),
    ]);
    return true;
  }
  const wait = Math.min(FIRST_RETRY_MS * 2 ** notice.attempts, MAX_RETRY_MS);
  await db
    .update(expiryNotices)
    .set({ pushedAt, attempts: notice.attempts + 1, nextAttemptAt: now + wait })
    .where(ofNotice);
  return false;
}

/**
 * Reminds athletes whose noticed clips go within REMIND_FROM_MS, once per
 * notice and at most once a day. Best effort: the notice is what counts.
 */
async function sendReminders(env: Env, db: Db, now: number): Promise<number> {
  const dueNow = and(
    isNotNull(expiryNotices.givenAt),
    isNull(expiryNotices.remindedAt),
    lte(expiryNotices.goesAt, now + REMIND_FROM_MS),
  );
  const due = await db
    .selectDistinct({ userId: expiryNotices.userId })
    .from(expiryNotices)
    .where(
      and(
        dueNow,
        sql`not exists (
          select 1 from expiry_notices as recent
          where recent.user_id = ${expiryNotices.userId}
            and recent.reminded_at > ${now - REMINDER_GAP_MS}
        )`,
      ),
    )
    .limit(PER_RUN);

  let sent = 0;
  for (const { userId } of due) {
    // Claimed first, so overlapping runs can't both remind.
    const claimed = await db
      .update(expiryNotices)
      .set({ remindedAt: now })
      .where(and(eq(expiryNotices.userId, userId), dueNow))
      .returning({ batch: expiryNotices.batch, goesAt: expiryNotices.goesAt });
    const first = claimed.reduce<(typeof claimed)[number] | null>(
      (soonest, notice) => (soonest && soonest.goesAt <= notice.goesAt ? soonest : notice),
      null,
    );
    if (!first || first.goesAt - now < REMIND_UNTIL_MS) continue;
    const left = await db
      .select({ clips: count() })
      .from(files)
      .where(
        and(
          eq(files.ownerId, userId),
          inArray(
            files.expiryNoticeBatch,
            claimed.map((notice) => notice.batch),
          ),
          isComplete,
        ),
      )
      .get();
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!left?.clips || !user || user.deletedAt) continue;

    const news = { clips: left.clips, day: dayOf(first.goesAt), when: "reminder" as const };
    // The same collapse ID as the notice: on the phone, this replaces it.
    const pushed = await push(env, db, userId, news, `expiring-${first.batch}`, now);
    const emailed =
      hasAddress(user) &&
      (await email(env, user, news, `clips-expiring/reminder/${userId}/${first.batch}`));
    if (pushed || emailed) sent++;
  }
  return sent;
}

function hasAddress(user: UserRow): user is UserRow & { email: string } {
  return Boolean(user.email && user.emailVerified);
}

/** Emails the athlete; true once Resend has it (now, or earlier under this key). */
async function email(
  env: Env,
  user: UserRow & { email: string },
  news: { clips: number; day: number; when: "notice" | "reminder" },
  idempotencyKey: string,
): Promise<boolean> {
  try {
    const email = await clipsExpiringEmail({ appUrl: env.APP_URL, ...news });
    await sendEmail(env, { ...email, to: user.email, idempotencyKey, category: "clips-expiring" });
    return true;
  } catch (error) {
    console.error("expiry: email failed", user.id, error);
    return false;
  }
}

/**
 * Pushes to the athlete's phones this server can reach; true if any took it.
 * Phones Apple says are gone are forgotten.
 */
async function push(
  env: Env,
  db: Db,
  userId: string,
  news: { clips: number; day: number; when: "notice" | "reminder" },
  collapseId: string,
  now: number,
): Promise<boolean> {
  if (!env.APNS_KEY) return false;
  const phones = await db
    .select({ token: devices.token })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.environment, env.APNS_ENVIRONMENT)))
    .limit(PHONES_PER_ATHLETE);
  const alert = clipsExpiringPush(news);
  const outcomes = await Promise.all(
    phones.map(async ({ token }) => {
      const outcome = await pushAlert(env, token, alert, {
        data: { hop: "expiring" },
        collapseId,
        now,
      }).catch((error) => {
        console.error("expiry: push failed", error);
        return "failed" as const;
      });
      if (outcome === "gone") await db.delete(devices).where(eq(devices.token, token));
      return outcome;
    }),
  );
  return outcomes.includes("sent");
}

/**
 * The cleanup's part: free-plan clips whose notice was given and whose day
 * has ended everywhere go, to be removed from R2 by the cleanup's loop (or
 * hidden if held for a report). Returns how many.
 */
export async function expireClips(db: Db, now = Date.now(), limit = 5000): Promise<number> {
  const due = db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        // Read through files_goes_idx.
        lte(files.expiryGoesAt, now),
        isComplete,
        lte(files.completedAt, now - RETENTION_MS),
        not(hasPlusSql(files.ownerId, now)),
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

/**
 * For the plan: how many of the athlete's clips they've been told are
 * leaving, the day the first of them was named for, and when that is.
 */
export async function expiring(db: Db, userId: string) {
  const row = await db
    .select({ clips: count(), at: min(files.expiryGoesAt) })
    .from(files)
    .where(
      and(
        // Read through files_notice_idx.
        eq(files.ownerId, userId),
        isNotNull(files.expiryNoticeBatch),
        isNotNull(files.expiryGoesAt),
        isComplete,
      ),
    )
    .get();
  if (!row || row.clips === 0 || row.at === null) return null;
  const at = Number(row.at);
  return { clips: row.clips, on: new Date(dayOf(at)).toISOString().slice(0, 10), at };
}

/**
 * The cleanup's housekeeping: notices whose clips are all gone (or were let
 * go) and are old enough not to count toward a day's limit.
 */
export async function forgetOldNotices(db: Db, now = Date.now()): Promise<void> {
  await db.delete(expiryNotices).where(
    and(
      lte(expiryNotices.batch, now - 2 * DAY_MS),
      sql`not exists (
          select 1 from ${files}
          where ${files.ownerId} = ${expiryNotices.userId}
            and ${files.expiryNoticeBatch} = ${expiryNotices.batch}
        )`,
    ),
  );
}
