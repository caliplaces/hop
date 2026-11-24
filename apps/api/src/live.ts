import { cleanName } from "@hop/shared";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { getDb } from "./db";
import { liveActivities } from "./db/schema";
import type { Env } from "./env";
import { pushLiveActivity } from "./lib/apns";
import { arrivalsSince } from "./lib/arrivals";
import { pushFcmEventUpdate, serviceAccount } from "./lib/fcm";

/**
 * At most one alert (screen lights up, Dynamic Island expands) per Live
 * Activity in this long; updates in between are quiet. At an event clips come
 * in bursts, and a phone lighting up for each one in a pocket helps no one.
 */
export const ALERT_EVERY_MS = 5 * 60 * 1000;

/**
 * After a clip lands in a hop: updates every Event mode counting it (an
 * iPhone's Live Activity, or an Android phone's notification) with the clips
 * since its own start, and who sent the latest. Tokens Apple or Google no
 * longer accept are forgotten.
 */
export async function pushArrivals(env: Env, hopId: string, now = Date.now()) {
  const reachable = [
    ...(env.APNS_KEY ? [eq(liveActivities.platform, "apns")] : []),
    ...(serviceAccount(env) ? [eq(liveActivities.platform, "fcm")] : []),
  ];
  if (reachable.length === 0) return;
  const db = getDb(env.DB);
  const watching = await db
    .select()
    .from(liveActivities)
    .where(
      and(eq(liveActivities.hopId, hopId), gt(liveActivities.expiresAt, now), or(...reachable)),
    );

  await Promise.all(
    watching.map(async (activity) => {
      const { count, latest } = await arrivalsSince(db, hopId, activity.since, 1);
      // Typed by a stranger: shown cleaned, as everywhere else.
      const sender = latest[0]?.contributorName
        ? cleanName(latest[0].contributorName) || null
        : null;
      // Claim the alert before sending, in one conditional update: when a
      // burst of uploads completes at once, only one of them wins it.
      const alerting =
        count > 0 &&
        (await db
          .update(liveActivities)
          .set({ alertedAt: now })
          .where(
            and(
              eq(liveActivities.token, activity.token),
              or(
                isNull(liveActivities.alertedAt),
                lte(liveActivities.alertedAt, now - ALERT_EVERY_MS),
              ),
            ),
          )
          .returning({ token: liveActivities.token })
          .get()) !== undefined;
      const outcome = await (activity.platform === "fcm"
        ? pushFcmEventUpdate(env, activity.token, {
            userId: activity.userId,
            hopId,
            since: activity.since,
            clips: count,
            latest: sender,
            alert: alerting,
            now,
          })
        : pushLiveActivity(
            env,
            activity.token,
            { clips: count, latest: sender },
            {
              now,
              alert: alerting
                ? {
                    title: "New clip",
                    body: sender ? `${sender} sent a clip` : "A clip just landed",
                  }
                : undefined,
            },
          )
      ).catch((error) => {
        console.error("live activity: push failed", activity.platform, error);
        return "failed" as const;
      });
      if (outcome === "sent") {
        // Counted on the phone: the new-clips push leaves these out (notify.ts).
        await db
          .update(liveActivities)
          .set({ pushedAt: now })
          .where(
            and(
              eq(liveActivities.token, activity.token),
              or(isNull(liveActivities.pushedAt), lte(liveActivities.pushedAt, now)),
            ),
          );
      } else if (outcome === "gone") {
        await db.delete(liveActivities).where(eq(liveActivities.token, activity.token));
      } else if (outcome === "failed" && alerting) {
        // It didn't reach the phone: hand the alert back for the next clip,
        // unless a later claim has replaced this one meanwhile.
        await db
          .update(liveActivities)
          .set({ alertedAt: activity.alertedAt })
          .where(and(eq(liveActivities.token, activity.token), eq(liveActivities.alertedAt, now)));
      }
    }),
  );
}
