import { colorFor } from "@hop/shared";
import { and, eq, isNotNull, isNull, lte, max, min, or } from "drizzle-orm";
import { type Db, getDb } from "./db";
import { files, hops, users } from "./db/schema";
import { newClipsEmail } from "./email/new-clips";
import { ResendError, sendEmail } from "./email/send";
import { listUnsubscribeHeaders, unsubscribeLinks } from "./email/unsubscribe";
import type { Env } from "./env";

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
 * crowd out the rest. Other channels (push) can hang off the same batches.
 */
export const QUIET_MS = 10 * 60 * 1000;
export const MAX_DELAY_MS = 60 * 60 * 1000;
/** A batch still unconfirmed this long after its last attempt failed or was interrupted; send it again. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** Resend remembers idempotency keys for 24 hours. Past that a retry could email twice, so stop. */
const GIVE_UP_AFTER_MS = 23 * 60 * 60 * 1000;
/** Athletes handled per run (every 5 minutes); anyone left over goes next run. */
const PER_RUN = 25;

// Every query below repeats these terms so it can use files_unannounced_idx,
// which only holds finished, unannounced uploads (see schema.ts).
const unannounced = and(isNotNull(files.completedAt), isNull(files.notifiedAt));
const waiting = and(unannounced, isNull(files.notifyBatch));

export async function announceNewClips(env: Env, now = Date.now()): Promise<void> {
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
  const attempt = async (ownerId: string, batch: number) => {
    try {
      outcomes[await sendBatch(env, db, ownerId, batch, now)]++;
    } catch (error) {
      outcomes.failed++;
      // The batch stays claimed but unconfirmed, so a later run sends it again.
      console.error("new clips: send failed, will retry", ownerId, batch, error);
    }
  };

  // One athlete at a time keeps each run light; a failure only affects that athlete.
  for (const { ownerId, batch } of stalled) {
    if (batch !== null) await attempt(ownerId, batch);
  }
  for (const { ownerId } of due) {
    // Claim atomically, so overlapping runs can't put a clip in two batches.
    const claimed = await db
      .update(files)
      .set({ notifyBatch: now, notifyAttemptedAt: now })
      .where(and(eq(files.ownerId, ownerId), waiting))
      .returning({ id: files.id });
    if (claimed.length > 0) await attempt(ownerId, now);
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
      .select({ hopId: files.hopId, contributor: files.contributorName, status: files.status })
      .from(files)
      .where(inBatch)
  ).filter((clip) => clip.status === "complete");
  const user = await db.select().from(users).where(eq(users.id, ownerId)).get();
  // Athletes who opted out (or can't receive email) have their clips marked
  // announced anyway, so they don't pile up and get re-checked every run.
  if (
    clips.length === 0 ||
    !user?.handle ||
    !user.email ||
    !user.emailVerified ||
    !user.emailNewClips
  ) {
    await confirm();
    return "skipped";
  }

  const athleteHops = await db
    .select({ id: hops.id, slug: hops.slug, title: hops.title })
    .from(hops)
    .where(eq(hops.ownerId, ownerId));
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
