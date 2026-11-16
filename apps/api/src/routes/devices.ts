import { deviceSchema } from "@hop/shared";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { devices } from "../db/schema";
import type { AppEnv } from "../env";
import { fail } from "../lib/http";
import { PHONES_PER_ATHLETE } from "../lib/phones";
import { currentUser, requireUser } from "../lib/session";
import { validate } from "../lib/validate";

/** An APNs device token: 32 bytes as hex today, longer allowed. */
const TOKEN = /^[0-9a-f]{64,200}$/;

/**
 * The app's push token, for notifications such as clips about to expire.
 * One per install: signing in to another account on the same phone moves it
 * there. The app removes it on sign-out. An athlete keeps their newest
 * PHONES_PER_ATHLETE.
 *
 * Moving a token needs only the token, which Apple issues to that one app
 * install (32 random bytes) and the API never hands out; whoever has it
 * could only stop that phone hearing of its own clips.
 */
export const deviceRoutes = new Hono<AppEnv>()
  .put("/me/devices/:token", requireUser, validate("json", deviceSchema), async (c) => {
    const user = currentUser(c);
    const token = c.req.param("token").toLowerCase();
    if (!TOKEN.test(token)) return fail(c, 400, "invalid_token", "That isn't a push token.");
    const { environment } = c.req.valid("json");
    // This server's key only reaches one APNs environment; a token from the
    // other (a debug build against production, say) could never be used.
    if (environment !== c.env.APNS_ENVIRONMENT) {
      return fail(c, 409, "wrong_environment", "Notifications aren't available for this build.");
    }
    // The app registers each launch; a script registering thousands of
    // tokens to have them all pushed to is stopped here, and by the cap below.
    const { success } = await c.env.PROFILE_LIMITER.limit({ key: `devices:${user.id}` });
    if (!success) return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
    const now = Date.now();
    const db = getDb(c.env.DB);
    await db
      .insert(devices)
      .values({ token, userId: user.id, environment, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: devices.token,
        set: { userId: user.id, environment, updatedAt: now },
      });
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
    await getDb(c.env.DB)
      .delete(devices)
      .where(
        and(eq(devices.token, c.req.param("token").toLowerCase()), eq(devices.userId, user.id)),
      );
    return c.json({ ok: true });
  });
