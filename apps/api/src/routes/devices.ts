import { deviceSchema } from "@hop/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { devices } from "../db/schema";
import type { AppEnv } from "../env";
import { fail } from "../lib/http";
import { currentUser, requireUser } from "../lib/session";
import { validate } from "../lib/validate";

/** An APNs device token: 32 bytes as hex today, longer allowed. */
const TOKEN = /^[0-9a-f]{64,200}$/;

/**
 * The app's push token, for notifications such as clips about to expire.
 * One per install: signing in to another account on the same phone moves it
 * there. The app removes it on sign-out.
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
    const now = Date.now();
    await getDb(c.env.DB)
      .insert(devices)
      .values({ token, userId: user.id, environment, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: devices.token,
        set: { userId: user.id, environment, updatedAt: now },
      });
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
