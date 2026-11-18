import { and, eq, or } from "drizzle-orm";
import type { Db } from "../db";
import { devices } from "../db/schema";
import type { Env } from "../env";
import { type PushAlertOptions, type PushOutcome, pushAlert } from "./apns";
import { pushFcmAlert, serviceAccount } from "./fcm";

/** Phones pushed to per athlete; registering keeps no more (routes/devices.ts). */
export const PHONES_PER_ATHLETE = 5;

/** Whether this server can push to any phone at all: it has an APNs key or an FCM service account. */
export function canPush(env: Env): boolean {
  return Boolean(env.APNS_KEY) || serviceAccount(env) !== null;
}

/**
 * Pushes a notification to each of the athlete's phones this server can
 * reach: iPhones through APNs (their environment matching this server's
 * key), Android phones through FCM. True if any took it. Phones Apple or
 * Google say are gone are forgotten. Best effort: failures are logged, never
 * thrown.
 */
export async function pushToPhones(
  env: Env,
  db: Db,
  userId: string,
  alert: { title: string; body: string },
  options: PushAlertOptions,
): Promise<boolean> {
  const reachable = [
    ...(env.APNS_KEY
      ? [and(eq(devices.platform, "apns"), eq(devices.environment, env.APNS_ENVIRONMENT))]
      : []),
    ...(serviceAccount(env) ? [eq(devices.platform, "fcm")] : []),
  ];
  if (reachable.length === 0) return false;
  try {
    const phones = await db
      .select({ token: devices.token, platform: devices.platform })
      .from(devices)
      .where(and(eq(devices.userId, userId), or(...reachable)))
      .limit(PHONES_PER_ATHLETE);
    const outcomes = await Promise.all(
      phones.map(async ({ token, platform }) => {
        const outcome: PushOutcome = await (platform === "fcm"
          ? pushFcmAlert(env, token, userId, alert, options)
          : pushAlert(env, token, alert, options)
        ).catch((error) => {
          console.error("push: failed", platform, error);
          return "failed" as const;
        });
        if (outcome === "gone") await db.delete(devices).where(eq(devices.token, token));
        return outcome;
      }),
    );
    return outcomes.includes("sent");
  } catch (error) {
    console.error("push: failed", userId, error);
    return false;
  }
}
