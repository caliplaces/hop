import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { devices } from "../db/schema";
import type { Env } from "../env";
import { type PushAlertOptions, pushAlert } from "./apns";

/** Phones pushed to per athlete; registering keeps no more (routes/devices.ts). */
export const PHONES_PER_ATHLETE = 5;

/**
 * Pushes a notification to each of the athlete's phones this server can
 * reach (their APNs environment matches); true if any took it. Phones Apple
 * says are gone are forgotten. Best effort: failures are logged, never thrown.
 */
export async function pushToPhones(
  env: Env,
  db: Db,
  userId: string,
  alert: { title: string; body: string },
  options: PushAlertOptions,
): Promise<boolean> {
  if (!env.APNS_KEY) return false;
  try {
    return await pushEach(env, db, userId, alert, options);
  } catch (error) {
    console.error("push: failed", userId, error);
    return false;
  }
}

async function pushEach(
  env: Env,
  db: Db,
  userId: string,
  alert: { title: string; body: string },
  options: PushAlertOptions,
): Promise<boolean> {
  const phones = await db
    .select({ token: devices.token })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.environment, env.APNS_ENVIRONMENT)))
    .limit(PHONES_PER_ATHLETE);
  const outcomes = await Promise.all(
    phones.map(async ({ token }) => {
      const outcome = await pushAlert(env, token, alert, options).catch((error) => {
        console.error("push: failed", error);
        return "failed" as const;
      });
      if (outcome === "gone") await db.delete(devices).where(eq(devices.token, token));
      return outcome;
    }),
  );
  return outcomes.includes("sent");
}
