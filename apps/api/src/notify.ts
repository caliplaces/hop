import { colorFor } from "@hop/shared";
import { and, eq, isNull, lte, max, min, or } from "drizzle-orm";
import { type Db, getDb } from "./db";
import { files, hops, users } from "./db/schema";
import { newClipsEmail } from "./email/new-clips";
import { sendEmail } from "./email/send";
import { listUnsubscribeHeaders, unsubscribeLinks } from "./email/unsubscribe";
import type { Env } from "./env";
import { sha256Hex } from "./lib/crypto";

/**
 * The new-clips digest. At an event clips arrive in bursts, so instead of one
 * email per clip, an athlete hears about a burst once uploads have been quiet
 * for QUIET_MS, or at the latest MAX_DELAY_MS after its first clip.
 *
 * A clip is "announced" once files.notified_at is set. That marker is the
 * pipeline's state, so other channels (push) can hang off the same claim.
 */
export const QUIET_MS = 10 * 60 * 1000;
export const MAX_DELAY_MS = 60 * 60 * 1000;
/** Athletes handled per run (every 5 minutes); anyone left over goes next run. */
const ATHLETES_PER_RUN = 25;

const unannounced = and(eq(files.status, "complete"), isNull(files.notifiedAt));

export async function announceNewClips(env: Env, now = Date.now()): Promise<void> {
  const db = getDb(env.DB);
  const due = await db
    .select({ ownerId: files.ownerId })
    .from(files)
    .where(unannounced)
    .groupBy(files.ownerId)
    .having(
      or(
        lte(max(files.completedAt), now - QUIET_MS),
        lte(min(files.completedAt), now - MAX_DELAY_MS),
      ),
    )
    .limit(ATHLETES_PER_RUN);

  let sent = 0;
  let failed = 0;
  // One athlete at a time keeps each run light; a failure only affects that athlete.
  for (const { ownerId } of due) {
    try {
      if (await announceTo(env, db, ownerId, now)) sent++;
    } catch (error) {
      failed++;
      console.error("new clips: announcing failed, will retry", ownerId, error);
    }
  }
  if (due.length > 0) {
    console.log(`new clips: ${due.length} athletes due, ${sent} emails sent, ${failed} failed`);
  }
}

/** Returns whether an email went out. */
async function announceTo(env: Env, db: Db, ownerId: string, now: number): Promise<boolean> {
  // Claim atomically, so overlapping runs can't announce the same clips twice.
  const claimed = await db
    .update(files)
    .set({ notifiedAt: now })
    .where(and(eq(files.ownerId, ownerId), unannounced))
    .returning({ id: files.id, hopId: files.hopId, contributor: files.contributorName })
    .all();
  if (claimed.length === 0) return false;

  // Athletes who opted out (or can't receive email) still have their clips
  // claimed, so they don't pile up and get re-checked every run.
  const user = await db.select().from(users).where(eq(users.id, ownerId)).get();
  if (!user?.handle || !user.email || !user.emailVerified || !user.emailNewClips) return false;

  try {
    const athleteHops = await db
      .select({ id: hops.id, slug: hops.slug, title: hops.title })
      .from(hops)
      .where(eq(hops.ownerId, ownerId));
    const links = await unsubscribeLinks(env, user.id);
    const email = await newClipsEmail({
      appUrl: env.APP_URL,
      color: colorFor(user.color, user.id),
      clips: claimed,
      hops: athleteHops,
      unsubscribeUrl: links.page,
    });
    // Same clips, same key: if a send times out but actually went through,
    // the retry is dropped by Resend instead of emailing twice.
    const ids = claimed.map((clip) => clip.id).sort();
    const digest = (await sha256Hex(ids.join(","))).slice(0, 32);
    await sendEmail(env, {
      ...email,
      to: user.email,
      idempotencyKey: `new-clips/${ownerId}/${digest}`,
      category: "new-clips",
      headers: listUnsubscribeHeaders(links.oneClick),
    });
    return true;
  } catch (error) {
    // Hand the clips back so the next run tries again.
    await db
      .update(files)
      .set({ notifiedAt: null })
      .where(and(eq(files.ownerId, ownerId), eq(files.notifiedAt, now)));
    throw error;
  }
}
