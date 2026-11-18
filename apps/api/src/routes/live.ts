import { liveActivitySchema } from "@hop/shared";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { hops, liveActivities } from "../db/schema";
import type { AppEnv } from "../env";
import { FCM_TOKEN } from "../lib/fcm";
import { fail } from "../lib/http";
import { currentUser, requireUser } from "../lib/session";
import { validate } from "../lib/validate";

/** Live Activities end within 12 hours; a registration lasts as long. */
export const LIVE_ACTIVITY_TTL_MS = 12 * 60 * 60 * 1000;
/** Registrations kept per athlete (one per device and event is plenty), newest first. */
export const LIVE_ACTIVITIES_PER_USER = 5;
/** APNs push tokens are hex; Live Activity tokens run to about 80 bytes. */
const APNS_TOKEN = /^[0-9a-f]{32,400}$/;

export const liveActivityRoutes = new Hono<AppEnv>()
  .use("/me/live-activities/*", requireUser)

  /**
   * Event mode's push token, so the API can update its count while the phone
   * is locked: a Live Activity's on the iPhone, the app's FCM token on
   * Android. Registering again (a new event, or after a relaunch) refreshes it.
   */
  .put("/me/live-activities/:token", validate("json", liveActivitySchema), async (c) => {
    const user = currentUser(c);
    const input = c.req.valid("json");
    const raw = c.req.param("token");
    // APNs tokens are hex, kept in lowercase; FCM's case matters.
    const token = input.platform === "apns" ? raw.toLowerCase() : raw;
    if (!(input.platform === "apns" ? APNS_TOKEN : FCM_TOKEN).test(token)) {
      return fail(c, 400, "invalid_token");
    }
    // This server's key only reaches one APNs environment; a token from the
    // other (a debug build against production, say) could never be updated.
    if (input.platform === "apns" && input.environment !== c.env.APNS_ENVIRONMENT) {
      return fail(c, 409, "wrong_environment", "Push updates aren't available for this build.");
    }
    // The app registers each event and relaunch; a script registering made-up
    // tokens by the hundred is stopped here, and by the cap below.
    const { success } = await c.env.PROFILE_LIMITER.limit({ key: `live:${user.id}` });
    if (!success) return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
    const db = getDb(c.env.DB);
    const hop = await db
      .select({ id: hops.id })
      .from(hops)
      .where(and(eq(hops.id, input.hopId), eq(hops.ownerId, user.id)))
      .get();
    if (!hop) return fail(c, 404, "not_found");

    const now = Date.now();
    const registered = await db
      .insert(liveActivities)
      .values({
        token,
        platform: input.platform,
        userId: user.id,
        hopId: hop.id,
        since: input.since,
        createdAt: now,
        expiresAt: now + LIVE_ACTIVITY_TTL_MS,
      })
      .onConflictDoUpdate({
        target: liveActivities.token,
        set: {
          userId: user.id,
          hopId: hop.id,
          since: input.since,
          expiresAt: now + LIVE_ACTIVITY_TTL_MS,
        },
        // A token is only ever its own platform's. A Live Activity's is only
        // ever its own athlete's. Android's is the app install's, so it moves
        // to whoever signed in there, like the phone's (routes/devices.ts).
        setWhere:
          input.platform === "fcm"
            ? eq(liveActivities.platform, "fcm")
            : and(eq(liveActivities.userId, user.id), eq(liveActivities.platform, "apns")),
      })
      .returning({ token: liveActivities.token })
      .get();
    if (!registered) return fail(c, 409, "token_taken");

    // Keep the newest few, so uploads never fan out to a pile of stale tokens.
    const keep = db
      .select({ token: liveActivities.token })
      .from(liveActivities)
      .where(eq(liveActivities.userId, user.id))
      .orderBy(desc(liveActivities.createdAt), desc(liveActivities.token))
      .limit(LIVE_ACTIVITIES_PER_USER);
    await db
      .delete(liveActivities)
      .where(and(eq(liveActivities.userId, user.id), notInArray(liveActivities.token, keep)));
    return c.json({ ok: true });
  })

  /** Event mode ended: no more updates for this token. */
  .delete("/me/live-activities/:token", async (c) => {
    const user = currentUser(c);
    const raw = c.req.param("token");
    await getDb(c.env.DB)
      .delete(liveActivities)
      .where(
        and(
          // An APNs token in any case, or an FCM token exactly.
          inArray(liveActivities.token, [...new Set([raw, raw.toLowerCase()])]),
          eq(liveActivities.userId, user.id),
        ),
      );
    return c.json({ ok: true });
  });
