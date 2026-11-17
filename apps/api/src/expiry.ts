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
  notExists,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { type Db, getDb } from "./db";
import {
  type ExpiryNoticeRow,
  emailSuppressions,
  expiryNotices,
  files,
  type UserRow,
  undeliveredEmails,
  users,
} from "./db/schema";
import { clipsExpiringEmail, clipsExpiringPush } from "./email/clips-expiring";
import { type SendResult, sendEmail } from "./email/send";
import { isSuppressed } from "./email/suppressions";
import type { Env } from "./env";
import { goneStatus } from "./lib/files";
import { pushToPhones } from "./lib/phones";
import { hasPlusSql } from "./lib/plans";

/**
 * Free-plan expiry. Free clips are kept for PLANS.free.retentionDays (30),
 * then removed for good, from R2 too. Before that the athlete is told:
 *
 *   notice    a week ahead (EXPIRY_NOTICE_DAYS): "12 clips leave your inbox
 *             on Monday 23 November", by email to their verified address,
 *             and pushed to their phone if they turned notifications on
 *   reminder  the day before: "Last call: …", best effort
 *
 * A notice names a calendar day, the same wherever the athlete is, and its
 * clips stay until that day has ended everywhere (UTC−12): at least seven and
 * a half days after it was claimed.
 *
 * Only the email counts: a notice is given once Resend accepted it for the
 * athlete's verified address. A push can be silenced in Settings, or sit
 * undelivered on a phone that's off, and still be accepted, so it's never
 * enough on its own; athletes without a verified address are never noticed,
 * and their clips stay. Nor are athletes whose address Hop no longer emails
 * (it bounced for good, or they reported Hop's email as spam: see
 * email/suppressions.ts). Until a notice is given its clips stay, however
 * old. One that can't get through is let go after GIVE_UP_AFTER_MS and
 * claimed afresh the next day, never assumed given. And one Resend accepted
 * but whose email never arrived (it bounced, even for now, or failed, or
 * Resend didn't send it) is let go when its webhook says so, by the email's
 * ID (letGoUndelivered), and claimed afresh the next day.
 *
 * Each athlete gets at most one notice a day, covering every clip due one,
 * and at most one reminder a day. Hop+ clears all of it, and for a while
 * after it ends (LAPSE_MARGIN_MS) nothing is noticed or removed, so a renewal
 * Apple hasn't told the API of yet can't cost a subscriber their clips.
 *
 * The state is in expiry_notices (one row per athlete and batch) and on each
 * clip: files.expiry_notice_batch (claimed into that notice) and
 * files.expiry_goes_at (set once the notice is given: when it may go).
 * Every change of a notice's state is conditional on the state it changes
 * from, so overlapping runs can't undo each other's work, and removal checks
 * the notice itself again, not just the clip's time.
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
/** After Hop+ ends, nothing is noticed or removed for this long (see above). */
export const LAPSE_MARGIN_MS = 30 * DAY_MS;
/** Reminders go once the clips are this close to going… */
const REMIND_FROM_MS = 2 * DAY_MS;
/** …and not this close: too late to help. */
const REMIND_UNTIL_MS = 60 * 60 * 1000;
/** At most one reminder within this long. */
const REMINDER_GAP_MS = 23 * 60 * 60 * 1000;
/** A reminder skipped as too late: marked done, but not counted as one sent. */
const SKIPPED = 0;
/** Athletes handled per run, for each of claiming, sending and reminding. */
const PER_RUN = 25;
/**
 * A run trying a notice holds it this long, so the next run leaves it alone
 * meanwhile: well over a run's budget and its sends' timeouts.
 */
const LEASE_MS = 10 * 60 * 1000;
/** A run stops starting new sends after this, so runs five minutes apart rarely overlap. */
const RUN_BUDGET_MS = 3 * 60 * 1000;

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
 * them; the expiry tests check the plans both with and without statistics.
 */
const isComplete = sql`+${files.status} = 'complete'`;

/**
 * SQL: this athlete may be noticed now. Not deleted, a verified address to
 * tell that Hop still emails (lower(trim()) is exactly normalizeAddress, in
 * email/suppressions.ts), no Hop+ now or lately, and no notice claimed, or
 * given, in the last day.
 */
function claimable(userId: SQLWrapper, now: number): SQL {
  return sql`exists (
    select 1 from ${users} as owner
    where owner.id = ${userId}
      and owner.deleted_at is null
      and owner.email is not null
      and owner.email_verified = 1
      and not exists (
        select 1 from ${emailSuppressions}
        where ${emailSuppressions.email} = lower(trim(owner.email))
      )
  )
  and not ${hasPlusSql(userId, now - LAPSE_MARGIN_MS)}
  and not exists (
    select 1 from ${expiryNotices} as recent
    where recent.user_id = ${userId}
      and (recent.batch > ${now - DAY_MS} or recent.given_at > ${now - DAY_MS})
  )`;
}

/** SQL: the notice `batch` of `userId` exists, and isn't given. */
function noticeUnsent(userId: string, batch: number) {
  return sql`exists (
    select 1 from ${expiryNotices} as notice
    where notice.user_id = ${userId} and notice.batch = ${batch} and notice.given_at is null
  )`;
}

/**
 * Claims, sends and reminds whatever is due, and clears expiry for athletes
 * with Hop+. Runs with the five-minute email jobs.
 */
export async function remindOfExpiry(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env.DB);
  const started = Date.now();
  const inBudget = () => Date.now() - started < RUN_BUDGET_MS;
  await keepForHopPlus(db, now);
  await claimNotices(db, now);
  const given = await sendNotices(env, db, now, inBudget);
  const reminded = await sendReminders(env, db, now, inBudget);
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
 * Claims a notice for each athlete with clips due one (see claimable). Each
 * claim takes all their due clips at once, in one transaction that checks
 * again that they may be noticed, so overlapping runs can't put a clip in two
 * notices, or notice anyone twice in a day.
 */
async function claimNotices(db: Db, now: number) {
  const dueBy = now - (RETENTION_MS - NOTICE_MS);
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        // First: a few lookups by ID, which rule out Hop+ libraries before
        // any clip is read.
        claimable(users.id, now),
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
    // The notice, naming as many clips as it then claims; no row when there
    // are none, or when the athlete may no longer be noticed. Its clips are
    // claimed only if it was.
    await db.batch([
      db.insert(expiryNotices).select(
        db
          .select({
            userId: files.ownerId,
            batch: sql<number>`${now}`.as("batch"),
            clips: count().as("clips"),
            goesAt: sql<number>`${goesAt(statedDay(now))}`.as("goes_at"),
            attempts: sql<number>`0`.as("attempts"),
            nextAttemptAt: sql<number>`${now}`.as("next_attempt_at"),
            pushedAt: sql<number | null>`null`.as("pushed_at"),
            givenAt: sql<number | null>`null`.as("given_at"),
            emailId: sql<string | null>`null`.as("email_id"),
            abandonedAt: sql<number | null>`null`.as("abandoned_at"),
            remindedAt: sql<number | null>`null`.as("reminded_at"),
          })
          .from(files)
          .where(and(unnoticed, claimable(files.ownerId, now)))
          .groupBy(files.ownerId),
      ),
      db
        .update(files)
        .set({ expiryNoticeBatch: now, expiryGoesAt: null })
        .where(and(unnoticed, noticeUnsent(id, now))),
    ]);
  }
}

/** Sends the notices due a try, longest waiting first. Returns how many got through. */
async function sendNotices(env: Env, db: Db, now: number, inBudget: () => boolean) {
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
    if (!inBudget()) break;
    try {
      if (await sendNotice(env, db, notice, now)) given++;
    } catch (error) {
      console.error("expiry: notice failed, will retry", notice.userId, notice.batch, error);
    }
  }
  return given;
}

/** One try at a notice; true once it has reached the athlete. */
async function sendNotice(env: Env, db: Db, listed: ExpiryNoticeRow, now: number) {
  const ofNotice = and(
    eq(expiryNotices.userId, listed.userId),
    eq(expiryNotices.batch, listed.batch),
  );
  const stillSending = and(
    ofNotice,
    isNull(expiryNotices.givenAt),
    isNull(expiryNotices.abandonedAt),
  );
  // Taken for this try, or left alone if another run took it since it was
  // listed: one run at a time pushes and emails it.
  const notice = await db
    .update(expiryNotices)
    .set({ nextAttemptAt: now + LEASE_MS })
    .where(and(stillSending, eq(expiryNotices.nextAttemptAt, listed.nextAttemptAt)))
    .returning()
    .get();
  if (!notice) return false;
  const inNotice = and(eq(files.ownerId, notice.userId), eq(files.expiryNoticeBatch, notice.batch));
  // Its clips go back unclaimed, unless another run gave it meanwhile.
  const letGo = () =>
    db.batch([
      db.update(expiryNotices).set({ abandonedAt: now }).where(stillSending),
      db
        .update(files)
        .set({ expiryNoticeBatch: null, expiryGoesAt: null })
        .where(and(inNotice, noticeUnsent(notice.userId, notice.batch))),
    ]);

  const user = await db.select().from(users).where(eq(users.id, notice.userId)).get();
  const left = await db
    .select({ clips: count() })
    .from(files)
    .where(and(inNotice, isComplete))
    .get();
  if (
    !user ||
    user.deletedAt ||
    !hasAddress(user) ||
    !left?.clips ||
    (await isSuppressed(db, user.email))
  ) {
    // Nobody to tell any more (or an address Hop no longer emails), or
    // nothing left to tell them of.
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
  // Pushed once (a try that fails is tried again), whatever happens to the email.
  const pushed =
    notice.pushedAt === null &&
    (await push(env, db, user.id, news, `expiring-${notice.batch}`, now));
  const emailed = await email(env, user, news, `clips-expiring/notice/${user.id}/${notice.batch}`);
  const pushedAt = pushed ? { pushedAt: now } : {};

  if (emailed.status === "suppressed") {
    // Hop stopped emailing the address since it was checked above.
    await letGo();
    return false;
  }
  // Resend gives each email an ID, which is how a bounce finds the notice.
  // Without one (an answer that couldn't be read) the email is tried again,
  // under the same key, rather than counted. Only local development, which
  // logs emails instead of sending them, has none.
  const confirmed = emailed.status === "sent" && (emailed.emailId !== null || !env.RESEND_API_KEY);
  if (emailed.status === "sent" && confirmed) {
    const { emailId } = emailed;
    // Unless Resend has said already that it never arrived: its event can
    // come back before this is written. Checked in the same statement, so a
    // bounce either finds the notice given (letGoUndelivered) or stops it.
    const delivered = emailId
      ? notExists(
          db
            .select({ id: undeliveredEmails.emailId })
            .from(undeliveredEmails)
            .where(eq(undeliveredEmails.emailId, emailId)),
        )
      : undefined;
    const [given] = await db.batch([
      db
        .update(expiryNotices)
        .set({ givenAt: now, emailId, attempts: notice.attempts + 1, ...pushedAt })
        .where(and(stillSending, delivered))
        .returning({ userId: expiryNotices.userId }),
      // Only if it was given just now. Clips another run let go meanwhile
      // are no longer in it.
      db
        .update(files)
        .set({ expiryGoesAt: notice.goesAt })
        .where(
          and(
            inNotice,
            sql`exists (
              select 1 from ${expiryNotices} as notice
              where notice.user_id = ${notice.userId} and notice.batch = ${notice.batch}
                and notice.given_at = ${now} and notice.abandoned_at is null
            )`,
          ),
        ),
    ]);
    if (given.length > 0) return true;
    // Resend said it never arrived before it could be counted.
    if (emailId) await letGo();
    return false;
  }
  const wait = Math.min(FIRST_RETRY_MS * 2 ** notice.attempts, MAX_RETRY_MS);
  await db
    .update(expiryNotices)
    .set({ attempts: notice.attempts + 1, nextAttemptAt: now + wait, ...pushedAt })
    .where(stillSending);
  return false;
}

/**
 * Reminds athletes whose noticed clips go within REMIND_FROM_MS: one notice
 * at a time, the soonest first, at most once a day. Best effort: the notice
 * is what counts.
 */
async function sendReminders(env: Env, db: Db, now: number, inBudget: () => boolean) {
  const dueNow = and(
    isNotNull(expiryNotices.givenAt),
    isNull(expiryNotices.abandonedAt),
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
    if (!inBudget()) break;
    const pending = await db
      .select({ batch: expiryNotices.batch, goesAt: expiryNotices.goesAt })
      .from(expiryNotices)
      .where(and(eq(expiryNotices.userId, userId), dueNow))
      .orderBy(asc(expiryNotices.goesAt));
    // Too late to help: done with, without counting as today's reminder.
    const late = pending.filter((notice) => notice.goesAt - now < REMIND_UNTIL_MS);
    if (late.length > 0) {
      await db
        .update(expiryNotices)
        .set({ remindedAt: SKIPPED })
        .where(
          and(
            eq(expiryNotices.userId, userId),
            inArray(
              expiryNotices.batch,
              late.map((notice) => notice.batch),
            ),
            isNull(expiryNotices.remindedAt),
          ),
        );
    }
    const next = pending.find((notice) => notice.goesAt - now >= REMIND_UNTIL_MS);
    if (!next) continue;
    // Claimed first, so overlapping runs can't both remind.
    const claimed = await db
      .update(expiryNotices)
      .set({ remindedAt: now })
      .where(
        and(
          eq(expiryNotices.userId, userId),
          eq(expiryNotices.batch, next.batch),
          isNull(expiryNotices.remindedAt),
        ),
      )
      .returning({ batch: expiryNotices.batch });
    if (claimed.length === 0) continue;

    const left = await db
      .select({ clips: count() })
      .from(files)
      .where(
        and(
          eq(files.ownerId, userId),
          eq(files.expiryNoticeBatch, next.batch),
          isNotNull(files.expiryGoesAt),
          isComplete,
        ),
      )
      .get();
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!left?.clips || !user || user.deletedAt) continue;

    const news = { clips: left.clips, day: dayOf(next.goesAt), when: "reminder" as const };
    // The same collapse ID as the notice: on the phone, this replaces it.
    const pushed = await push(env, db, userId, news, `expiring-${next.batch}`, now);
    const emailed =
      hasAddress(user) &&
      (await email(env, user, news, `clips-expiring/reminder/${userId}/${next.batch}`)).status ===
        "sent";
    if (pushed || emailed) sent++;
  }
  return sent;
}

function hasAddress(user: UserRow): user is UserRow & { email: string } {
  return Boolean(user.email && user.emailVerified);
}

/**
 * Emails the athlete: "sent" once Resend has it (now, or earlier under this
 * key), with its ID; "suppressed" for an address Hop no longer emails;
 * "failed" to try again later.
 */
async function email(
  env: Env,
  user: UserRow,
  news: { clips: number; day: number; when: "notice" | "reminder" },
  idempotencyKey: string,
): Promise<SendResult | { status: "failed" }> {
  if (!hasAddress(user)) return { status: "failed" };
  try {
    const email = await clipsExpiringEmail({ appUrl: env.APP_URL, ...news });
    return await sendEmail(env, {
      ...email,
      to: user.email,
      idempotencyKey,
      category: "clips-expiring",
    });
  } catch (error) {
    console.error("expiry: email failed", user.id, error);
    return { status: "failed" };
  }
}

/** Pushes the news to the athlete's phones; true if any took it. */
function push(
  env: Env,
  db: Db,
  userId: string,
  news: { clips: number; day: number; when: "notice" | "reminder" },
  collapseId: string,
  now: number,
): Promise<boolean> {
  return pushToPhones(env, db, userId, clipsExpiringPush(news), {
    data: { hop: "expiring" },
    collapseId,
    now,
  });
}

/**
 * Resend says the email it gave `emailId` never arrived: it bounced (for
 * good or not), failed, or wasn't sent (see routes/email.ts). The notice it
 * gave, matched by that ID whatever the athlete's address is now, is let go
 * and its clips go back unclaimed. They stay until another notice reaches
 * the athlete: claimed afresh the next day, unless Hop no longer emails
 * them. Clips already removed are gone.
 */
export async function letGoUndelivered(db: Db, emailId: string, now = Date.now()) {
  const open = and(eq(expiryNotices.emailId, emailId), isNull(expiryNotices.abandonedAt));
  await db.batch([
    // Written down first, for a notice whose email hasn't been counted yet.
    db.insert(undeliveredEmails).values({ emailId, createdAt: now }).onConflictDoNothing(),
    // First the clips, while their notice still reads as not let go.
    db
      .update(files)
      .set({ expiryNoticeBatch: null, expiryGoesAt: null })
      .where(
        and(
          inArray(
            files.ownerId,
            db.select({ id: expiryNotices.userId }).from(expiryNotices).where(open),
          ),
          isComplete,
          sql`exists (
            select 1 from ${expiryNotices} as notice
            where notice.user_id = ${files.ownerId}
              and notice.batch = ${files.expiryNoticeBatch}
              and notice.email_id = ${emailId}
              and notice.abandoned_at is null
          )`,
        ),
      ),
    db.update(expiryNotices).set({ abandonedAt: now }).where(open),
  ]);
}

/**
 * The cleanup's part: free-plan clips whose notice was given and whose day
 * has ended everywhere go, to be removed from R2 by the cleanup's loop (or
 * hidden if held for a report). Returns how many.
 *
 * Checked here again, whatever the clip says: its notice was given and not
 * let go, and its athlete hasn't had Hop+ lately.
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
        sql`exists (
          select 1 from ${expiryNotices} as notice
          where notice.user_id = ${files.ownerId}
            and notice.batch = ${files.expiryNoticeBatch}
            and notice.given_at is not null
            and notice.abandoned_at is null
            and notice.goes_at <= ${now}
        )`,
        not(hasPlusSql(files.ownerId, now - LAPSE_MARGIN_MS)),
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
 * For the plan: the athlete's clips leaving first (the earliest notice's
 * day), how many, and when they go. Clips in later notices come up once
 * these have gone.
 */
export async function expiring(db: Db, userId: string) {
  // Read through files_notice_idx.
  const noticed = and(
    eq(files.ownerId, userId),
    isNotNull(files.expiryNoticeBatch),
    isNotNull(files.expiryGoesAt),
    isComplete,
  );
  const first = await db
    .select({ at: min(files.expiryGoesAt) })
    .from(files)
    .where(noticed)
    .get();
  if (first?.at == null) return null;
  const at = Number(first.at);
  const row = await db
    .select({ clips: count() })
    .from(files)
    .where(and(noticed, eq(files.expiryGoesAt, at)))
    .get();
  if (!row?.clips) return null;
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
