import { emailPreferenceSchema } from "@hop/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../db";
import { users } from "../db/schema";
import { suppress } from "../email/suppressions";
import { verifyUnsubscribeToken } from "../email/unsubscribe";
import { domainOf, undeliverable, verifyResendWebhook } from "../email/webhook";
import type { AppEnv } from "../env";
import { letGoUndelivered } from "../expiry";
import { fail } from "../lib/http";

/** Resend's events are a few KiB; refuse much bigger bodies before reading them. */
const limitWebhookBody = bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) => fail(c, 413, "too_large"),
});

const decoder = new TextDecoder();

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
  })

  /**
   * Resend's webhook, set in its dashboard for this environment: an email
   * that bounced for good, was reported as spam, or that Resend wouldn't
   * send. Hop stops emailing that address (email/suppressions.ts), and a
   * notice of clips about to go that never arrived no longer counts
   * (expiry.ts). Anything but a 2xx is retried, so events of no use here
   * still get a 200.
   */
  .post("/resend-webhook", limitWebhookBody, async (c) => {
    const secret = c.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return fail(c, 404, "not_found");
    const body = new Uint8Array(await c.req.arrayBuffer());
    const verified = await verifyResendWebhook(
      secret,
      {
        id: c.req.header("svix-id"),
        timestamp: c.req.header("svix-timestamp"),
        signature: c.req.header("svix-signature"),
      },
      body,
    );
    if (!verified) return fail(c, 400, "invalid_signature");
    let event: unknown;
    try {
      event = JSON.parse(decoder.decode(body));
    } catch {
      return fail(c, 400, "invalid_event");
    }
    const found = undeliverable(event, domainOf(c.env.EMAIL_FROM));
    if (found) {
      const db = getDb(c.env.DB);
      const now = Date.now();
      await suppress(db, found.addresses, found.reason, now);
      // A spam report means it arrived. Otherwise it never did.
      if (found.reason !== "complained") await letGoUndelivered(db, found.addresses, now);
      // Never log the address.
      console.log("email: stopped emailing an address", found.reason);
    }
    return c.json({ received: true });
  });
