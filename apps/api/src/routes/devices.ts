import { deviceSchema } from "@hop/shared";
import { and, desc, eq, ne, notInArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { devices, liveActivities } from "../db/schema";
import type { AppEnv } from "../env";
import { FCM_TOKEN } from "../lib/fcm";
import { fail } from "../lib/http";
import { PHONES_PER_ATHLETE } from "../lib/phones";
import { currentUser, requireUser } from "../lib/session";
import { validate } from "../lib/validate";

/** An APNs device token: 32 bytes as hex today, longer allowed. */
const APNS_TOKEN = /^[0-9a-f]{64,200}$/;

/**
 * The token in a URL, as stored: APNs tokens are hex, in lowercase; FCM's
 * are kept as given, since their case matters. Null if it isn't one.
 */
function pushToken(raw: string, platform: "apns" | "fcm"): string | null {
  const token = platform === "apns" ? raw.toLowerCase() : raw;
  return (platform === "apns" ? APNS_TOKEN : FCM_TOKEN).test(token) ? token : null;
}

/**
 * The apps' push token, for notifications such as clips about to expire:
 * the iPhone app's APNs token or the Android app's FCM token. One per
 * install: signing in to another account on the same phone moves it there.
 * The app removes it on sign-out. An athlete keeps their newest
 * PHONES_PER_ATHLETE.
 *
 * Moving a token needs only the token, which Apple or Google issues to that
 * one app install (long and random) and the API never hands out. Whoever had
 * one could move it to their own account: that phone would then show their
 * notifications (their events' titles and senders' names) instead of its
 * owner's. (The Android app also drops notifications for any account but
 * the one signed in.)
 */
export const deviceRoutes = new Hono<AppEnv>()
  .put("/me/devices/:token", requireUser, validate("json", deviceSchema), async (c) => {
    const user = currentUser(c);
    const input = c.req.valid("json");
    const token = pushToken(c.req.param("token"), input.platform);
    if (!token) return fail(c, 400, "invalid_token", "That isn't a push token.");
    // This server's key only reaches one APNs environment; a token from the
    // other (a debug build against production, say) could never be used.
    // FCM has only the one.
    const environment = input.platform === "apns" ? input.environment : "production";
    if (input.platform === "apns" && environment !== c.env.APNS_ENVIRONMENT) {
      return fail(c, 409, "wrong_environment", "Notifications aren't available for this build.");
    }
    // The app registers each launch; a script registering thousands of
    // tokens to have them all pushed to is stopped here, and by the cap below.
    const { success } = await c.env.PROFILE_LIMITER.limit({ key: `devices:${user.id}` });
    if (!success) return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
    const now = Date.now();
    const db = getDb(c.env.DB);
    const registered = await db
      .insert(devices)
      .values({
        token,
        userId: user.id,
        platform: input.platform,
        environment,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: devices.token,
        set: { userId: user.id, environment, updatedAt: now },
        // A token is only ever its own platform's.
        setWhere: eq(devices.platform, input.platform),
      })
      .returning({ token: devices.token })
      .get();
    if (!registered) return fail(c, 409, "token_taken");
    // On Android, Event mode updates go to the same token. One the last
    // account there left running (its sign-out never reached the API) stops.
    if (input.platform === "fcm") {
      await db
        .delete(liveActivities)
        .where(and(eq(liveActivities.token, token), ne(liveActivities.userId, user.id)));
    }
    // Their newest few phones; older ones are forgotten.
    const keep = db
      .select({ token: devices.token })
      .from(devices)
      .where(eq(devices.userId, user.id))
      .orderBy(desc(devices.updatedAt), desc(devices.token))
      .limit(PHONES_PER_ATHLETE);
    await db
      .delete(devices)
      .where(and(eq(devices.userId, user.id), notInArray(devices.token, keep)));
    return c.json({ ok: true });
  })

  .delete("/me/devices/:token", requireUser, async (c) => {
    const user = currentUser(c);
    const raw = c.req.param("token");
    await getDb(c.env.DB)
      .delete(devices)
      .where(
        and(
          // An FCM token exactly, or an APNs token in any case.
          or(
            eq(devices.token, raw),
            and(eq(devices.platform, "apns"), eq(devices.token, raw.toLowerCase())),
          ),
          eq(devices.userId, user.id),
        ),
      );
    return c.json({ ok: true });
  });
