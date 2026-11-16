import { colorFor } from "@hop/shared";
import { and, eq, gt, isNotNull, isNull, lte, max, min, or } from "drizzle-orm";
import { type Db, getDb } from "./db";
import { files, hops, liveActivities, users } from "./db/schema";
import { newClipsEmail, newClipsPush } from "./email/new-clips";
import { ResendError, sendEmail } from "./email/send";
import { listUnsubscribeHeaders, unsubscribeLinks } from "./email/unsubscribe";
import type { Env } from "./env";
import { pushToPhones } from "./lib/phones";

/**
 * The new-clips digest. At an event clips arrive in bursts, so instead of one
 * email per clip, an athlete hears about a burst once uploads have been quiet
 * for QUIET_MS, or at the latest MAX_DELAY_MS after its first clip.
 *
 * Each finished upload (completed_at set) moves through three states:
 *   waiting   notify_batch and notified_at both null
 *   batched   notify_batch = when it was claimed; its email isn't confirmed yet
 *   announced notified_at set
 * A batch is a fixed set of clips with a fixed idempotency key, so a retry
 * after a failed or interrupted send can never mix in newer clips and email
 * the old ones twice. Each attempt is recorded (notify_attempted_at) and the
 * least recently tried batches go first, so batches that keep failing can't
 * crowd out the rest.
 *
 * The same batch is pushed to the athlete's phones, once: when it's claimed,
 * never again on an email retry, and only one run can claim it. Clips the
 * athlete already saw counted on Event mode's Live Activity (an update that
 * reached the phone) are left out of the push (not the email).
 */
export const QUIET_MS = 10 * 60 * 1000;
export const MAX_DELAY_MS = 60 * 60 * 1000;
/** A batch still unconfirmed this long after its last attempt failed or was interrupted; send it again. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** Resend remembers idempotency keys for 24 hours. Past that a retry could email twice, so stop. */
const GIVE_UP_AFTER_MS = 23 * 60 * 60 * 1000;
/** Athletes handled per run (every 5 minutes); anyone left over goes next run. */
const PER_RUN = 25;
/** A run stops starting on athletes after this, so runs five minutes apart rarely overlap. */
const RUN_BUDGET_MS = 3 * 60 * 1000;
/**
 * Retries get at most this much of it, so an email outage (each try timing
 * out) can't keep fresh batches, and their pushes, waiting.
 */
const RETRY_BUDGET_MS = RUN_BUDGET_MS / 2;
/** iOS ends a Live Activity after eight hours: older registrations count nothing anyone sees. */
const LIVE_ACTIVITY_LIFETIME_MS = 8 * 60 * 60 * 1000;

// Every query below repeats these terms so it can use files_unannounced_idx,
// which only holds finished, unannounced uploads (see schema.ts).
const unannounced = and(isNotNull(files.completedAt), isNull(files.notifiedAt));
const waiting = and(unannounced, isNull(files.notifyBatch));

/** `clock` times the run against its budget (tests pass their own). */
export async function announceNewClips(
  env: Env,
  now = Date.now(),
  clock: () => number = Date.now,
): Promise<void> {
  const db = getDb(env.DB);

  // Batches whose send failed or whose run died: resend exactly those clips,
  // least recently tried first.
  const stalled = await db
    .select({ ownerId: files.ownerId, batch: files.notifyBatch })
    .from(files)
    .where(and(unannounced, lte(files.notifyAttemptedAt, now - RETRY_AFTER_MS)))
    .groupBy(files.ownerId, files.notifyBatch)
    .orderBy(min(files.notifyAttemptedAt))
    .limit(PER_RUN);

  // Athletes with waiting clips whose burst has gone quiet (or waited long enough).
  const due = await db
    .select({ ownerId: files.ownerId })
    .from(files)
    .where(waiting)
    .groupBy(files.ownerId)
    .having(
      or(
        lte(max(files.completedAt), now - QUIET_MS),
        lte(min(files.completedAt), now - MAX_DELAY_MS),
      ),
    )
    .limit(PER_RUN);

  const outcomes = { sent: 0, skipped: 0, failed: 0 };
  const started = clock();
  const attempt = async (ownerId: string, batch: number, push: boolean) => {
    try {
      outcomes[await sendBatch(env, db, ownerId, batch, now, push)]++;
    } catch (error) {
      outcomes.failed++;
      // The batch stays claimed but unconfirmed, so a later run sends it again.
      console.error("new clips: send failed, will retry", ownerId, batch, error);
    }
  };

  // One athlete at a time keeps each run light; a failure only affects that athlete.
  for (const { ownerId, batch } of stalled) {
    if (clock() - started > RETRY_BUDGET_MS) break;
    if (batch !== null) await attempt(ownerId, batch, false);
  }
  for (const { ownerId } of due) {
    if (clock() - started > RUN_BUDGET_MS) break;
    // Claim atomically, so overlapping runs can't put a clip in two batches.
    const claimed = await db
      .update(files)
      .set({ notifyBatch: now, notifyAttemptedAt: now })
      .where(and(eq(files.ownerId, ownerId), waiting))
      .returning({ id: files.id });
    // Just claimed: the one try that pushes.
    if (claimed.length > 0) await attempt(ownerId, now, true);
  }

  if (stalled.length + due.length > 0) {
    console.log(
      `new clips: ${outcomes.sent} sent, ${outcomes.skipped} skipped, ${outcomes.failed} failed`,
    );
  }
}

async function sendBatch(
  env: Env,
  db: Db,
  ownerId: string,
  batch: number,
  now: number,
  push: boolean,
): Promise<"sent" | "skipped"> {
  const inBatch = and(eq(files.ownerId, ownerId), eq(files.notifyBatch, batch), unannounced);
  const confirm = () => db.update(files).set({ notifiedAt: now }).where(inBatch);
  // Record the attempt first: if it fails, this batch goes to the back of the retry queue.
  await db.update(files).set({ notifyAttemptedAt: now }).where(inBatch);

  if (now - batch > GIVE_UP_AFTER_MS) {
    console.error("new clips: giving up on a batch after 23 hours", ownerId, batch);
    await confirm();
    return "skipped";
  }

  // Clips deleted since the claim drop out here (filtered in code, so the
  // query stays on the small index).
  const clips = (
    await db
      .select({
        hopId: files.hopId,
        contributor: files.contributorName,
        contributorUserId: files.contributorUserId,
        status: files.status,
        completedAt: files.completedAt,
      })
      .from(files)
      .where(inBatch)
  ).filter((clip) => clip.status === "complete");
  const user = await db.select().from(users).where(eq(users.id, ownerId)).get();
  if (clips.length === 0 || !user?.handle || user.deletedAt) {
    await confirm();
    return "skipped";
  }
  const athleteHops = await db
    .select({ id: hops.id, slug: hops.slug, title: hops.title })
    .from(hops)
    .where(eq(hops.ownerId, ownerId));

  // Best effort, and never in the email's way.
  const pushed =
    push &&
    user.pushNewClips &&
    (await pushBatch(env, db, ownerId, clips, athleteHops, now).catch((error) => {
      console.error("new clips: push failed", ownerId, batch, error);
      return false;
    }));

  // Athletes who opted out (or can't receive email) have their clips marked
  // announced anyway, so they don't pile up and get re-checked every run.
  if (!user.email || !user.emailVerified || !user.emailNewClips) {
    await confirm();
    return pushed ? "sent" : "skipped";
  }

  const links = await unsubscribeLinks(env, user.id);
  const email = await newClipsEmail({
    appUrl: env.APP_URL,
    color: colorFor(user.color, user.id),
    clips,
    hops: athleteHops,
    unsubscribeUrl: links.page,
  });

  try {
    await sendEmail(env, {
      ...email,
      to: user.email,
      // One key per batch: if an earlier attempt went through but timed out,
      // Resend drops the retry instead of sending it again.
      idempotencyKey: `new-clips/${ownerId}/${batch}`,
      category: "new-clips",
      headers: listUnsubscribeHeaders(links.oneClick),
    });
  } catch (error) {
    // This key was already used for a send whose payload differed (a Hop was
    // renamed or a clip deleted since): that earlier email went out.
    if (!(error instanceof ResendError && error.code === "invalid_idempotent_request")) {
      throw error;
    }
  }
  await confirm();
  return "sent";
}

/**
 * The batch on the athlete's phones, best effort. Clips Event mode's Live
 * Activity counted (in an event it's running for, since it started) are left
 * out: the athlete saw them arrive. True if a phone took it.
 */
async function pushBatch(
  env: Env,
  db: Db,
  ownerId: string,
  clips: {
    hopId: string;
    contributor: string | null;
    contributorUserId: string | null;
    completedAt: number | null;
  }[],
  athleteHops: { id: string; slug: string; title: string }[],
  now: number,
): Promise<boolean> {
  if (!env.APNS_KEY) return false;
  const watching = await db
    .select({
      hopId: liveActivities.hopId,
      since: liveActivities.since,
      pushedAt: liveActivities.pushedAt,
    })
    .from(liveActivities)
    .where(
      and(
        eq(liveActivities.userId, ownerId),
        gt(liveActivities.expiresAt, now),
        gt(liveActivities.createdAt, now - LIVE_ACTIVITY_LIFETIME_MS),
      ),
    );
  // Only what an update that reached the phone counted: one Apple refused
  // (busy, say) showed nothing.
  const counted = (clip: (typeof clips)[number]) =>
    watching.some(
      (activity) =>
        activity.hopId === clip.hopId &&
        activity.pushedAt !== null &&
        clip.completedAt !== null &&
        clip.completedAt >= activity.since &&
        clip.completedAt <= activity.pushedAt,
    );
  const news = clips.filter((clip) => !counted(clip));
  if (news.length === 0) return false;

  const { alert, hopId } = newClipsPush({
    clips: news.map((clip) => ({ ...clip, verified: clip.contributorUserId !== null })),
    hops: athleteHops,
  });
  return pushToPhones(env, db, ownerId, alert, {
    data: hopId ? { hop: "clips", hopId } : { hop: "clips" },
    // Grouped by event on the phone.
    threadId: hopId ?? "clips",
    now,
  });
}
