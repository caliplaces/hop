import { emailPreferenceSchema } from "@hop/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { users } from "../db/schema";
import { verifyUnsubscribeToken } from "../email/unsubscribe";
import type { AppEnv } from "../env";
import { fail } from "../lib/http";

export const emailRoutes = new Hono<AppEnv>()
  /**
   * Unsubscribe from new-clip emails, or `subscribe: true` to undo it.
   *
   * Two callers: mail apps' one-click unsubscribe (RFC 8058), which POSTs a
   * form to the List-Unsubscribe URL with the token in its query, and the
   * /unsubscribe page, which POSTs JSON. The signed token is the credential,
   * so no session is needed.
   */
  .post("/unsubscribe", async (c) => {
    let token = c.req.query("token");
    let subscribe = false;
    if (c.req.header("content-type")?.startsWith("application/json")) {
      const parsed = emailPreferenceSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return fail(c, 400, "invalid_request");
      token = parsed.data.token;
      subscribe = parsed.data.subscribe ?? false;
    }
    const payload = await verifyUnsubscribeToken(c.env, token);
    if (!payload) return fail(c, 400, "invalid_token", "This link has expired.");
    await getDb(c.env.DB)
      .update(users)
      .set({ emailNewClips: subscribe, updatedAt: Date.now() })
      .where(eq(users.id, payload.userId));
    return c.json({ ok: true, subscribed: subscribe });
  });
