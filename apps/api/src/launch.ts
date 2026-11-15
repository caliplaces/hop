import { LAUNCH_AT } from "@hop/shared";
import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { waitlist } from "./db/schema";
import { launchEmail } from "./email/launch";
import { ResendError, sendEmail } from "./email/send";
import type { Env } from "./env";
import { sha256Hex } from "./lib/crypto";

/**
 * The launch email, to everyone on the waitlist, from LAUNCH_AT on. It runs
 * with the five-minute digest, one email at a time (sendEmail paces them
 * under Resend's rate limit), for up to RUN_BUDGET_MS a run.
 *
 * Each address is claimed before its email goes out, so overlapping runs
 * can't both send it, and its idempotency key is fixed, so a retry after an
 * unconfirmed send can't email it twice. A failure is retried, RETRY_AFTER_MS
 * apart, MAX_ATTEMPTS times at most, and never once the key Resend remembers
 * for 24 hours could have expired: past that a retry might send it again.
 */
const RETRY_AFTER_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const GIVE_UP_AFTER_MS = 23 * 60 * 60 * 1000;
const RUN_BUDGET_MS = 3.5 * 60 * 1000;
const PAGE = 25;
/** Sent addresses stay a day, so someone joining again meanwhile isn't emailed twice. */
export const KEEP_SENT_MS = 24 * 60 * 60 * 1000;
/** Addresses the email never got through to go a week after the first try. */
export const KEEP_UNSENT_MS = 7 * 24 * 60 * 60 * 1000;

/** When the launch email goes out: LAUNCH_AT, or the environment's override. */
export function launchAt(env: Env): number {
  const override = env.LAUNCH_AT ? Date.parse(env.LAUNCH_AT) : Number.NaN;
  return Number.isNaN(override) ? LAUNCH_AT : override;
}

type Options = {
  now?: number;
  budgetMs?: number;
};

export async function announceLaunch(
  env: Env,
  { now = Date.now(), budgetMs = RUN_BUDGET_MS }: Options = {},
): Promise<void> {
  if (now < launchAt(env)) return;
  const db = getDb(env.DB);
  const started = Date.now();
  const due = () =>
    and(
      isNull(waitlist.notifiedAt),
      lt(waitlist.launchAttempts, MAX_ATTEMPTS),
      or(
        isNull(waitlist.launchFirstAttemptAt),
        gt(waitlist.launchFirstAttemptAt, Date.now() - GIVE_UP_AFTER_MS),
      ),
      or(
        isNull(waitlist.launchAttemptedAt),
        lte(waitlist.launchAttemptedAt, Date.now() - RETRY_AFTER_MS),
      ),
    );

  const email = await launchEmail({ appUrl: env.APP_URL, appStoreUrl: env.APP_STORE_URL });
  let sent = 0;
  let failed = 0;
  let stop = false;

  while (!stop && Date.now() - started < budgetMs) {
    const page = await db
      .select({ address: waitlist.email })
      .from(waitlist)
      .where(due())
      .orderBy(asc(waitlist.createdAt))
      .limit(PAGE);
    if (page.length === 0) break;

    for (const { address } of page) {
      if (Date.now() - started >= budgetMs) {
        stop = true;
        break;
      }
      // Claim it: another run, or a retry, now leaves it alone.
      const claimed = await db
        .update(waitlist)
        .set({
          launchFirstAttemptAt: sql`coalesce(${waitlist.launchFirstAttemptAt}, ${Date.now()})`,
          launchAttemptedAt: Date.now(),
          launchAttempts: sql`${waitlist.launchAttempts} + 1`,
        })
        .where(and(eq(waitlist.email, address), due()))
        .returning({ address: waitlist.email })
        .get();
      if (!claimed) continue;

      try {
        try {
          await sendEmail(env, {
            ...email,
            to: address,
            idempotencyKey: `launch/${await sha256Hex(address)}`,
            category: "launch",
          });
        } catch (error) {
          // The key was already used for an email that differed (the App
          // Store link was added meanwhile, say): that earlier one went out.
          if (!(error instanceof ResendError && error.code === "invalid_idempotent_request")) {
            throw error;
          }
        }
        await db
          .update(waitlist)
          .set({ notifiedAt: Date.now() })
          .where(eq(waitlist.email, address));
        sent++;
      } catch (error) {
        failed++;
        // Never log the address. Rate limited: the next run carries on.
        const reason = error instanceof ResendError ? `${error.status} ${error.code}` : error;
        console.error("launch: send failed, will retry", reason);
        if (error instanceof ResendError && error.status === 429) stop = true;
      }
      if (stop) break;
    }
  }
  if (sent || failed) console.log(`launch: sent ${sent}, failed ${failed}`);
}
