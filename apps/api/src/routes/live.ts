import { liveActivitySchema } from "@hop/shared";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { hops, liveActivities } from "../db/schema";
import type { AppEnv } from "../env";
import { fail } from "../lib/http";
import { currentUser, requireUser } from "../lib/session";
import { validate } from "../lib/validate";

/** Live Activities end within 12 hours; a registration lasts as long. */
export const LIVE_ACTIVITY_TTL_MS = 12 * 60 * 60 * 1000;
/** Registrations kept per athlete (one per device and event is plenty), newest first. */
export const LIVE_ACTIVITIES_PER_USER = 5;
/** APNs push tokens are hex; Live Activity tokens run to about 80 bytes. */
const TOKEN = /^[0-9a-f]{32,400}$/;

export const liveActivityRoutes = new Hono<AppEnv>()
  .use("/me/live-activities/*", requireUser)

  /**
   * Event mode's Live Activity, so the API can update its count while the
   * phone is locked. Registering again (a new event, or after a relaunch)
   * refreshes it.
   */
  .put("/me/live-activities/:token", validate("json", liveActivitySchema), async (c) => {
    const user = currentUser(c);
    const token = c.req.param("token").toLowerCase();
    if (!TOKEN.test(token)) return fail(c, 400, "invalid_token");
    const input = c.req.valid("json");
    // This server's key only reaches one APNs environment; a token from the
    // other (a debug build against production, say) could never be updated.
    if (input.environment !== c.env.APNS_ENVIRONMENT) {
      return fail(c, 409, "wrong_environment", "Push updates aren't available for this build.");
    }
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
        userId: user.id,
        hopId: hop.id,
        since: input.since,
        createdAt: now,
        expiresAt: now + LIVE_ACTIVITY_TTL_MS,
      })
      .onConflictDoUpdate({
        target: liveActivities.token,
        set: { hopId: hop.id, since: input.since, expiresAt: now + LIVE_ACTIVITY_TTL_MS },
        // A token is only ever its own athlete's.
        setWhere: eq(liveActivities.userId, user.id),
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

  /** Event mode ended: no more updates for this Live Activity. */
  .delete("/me/live-activities/:token", async (c) => {
    const user = currentUser(c);
    await getDb(c.env.DB)
      .delete(liveActivities)
      .where(
        and(
          eq(liveActivities.token, c.req.param("token").toLowerCase()),
          eq(liveActivities.userId, user.id),
        ),
      );
    return c.json({ ok: true });
  });
