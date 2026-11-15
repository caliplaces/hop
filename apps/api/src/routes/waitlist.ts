import { type JoinWaitlistResult, joinWaitlistSchema } from "@hop/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getDb } from "../db";
import { waitlist } from "../db/schema";
import type { AppEnv } from "../env";
import { clientIp, fail } from "../lib/http";
import { verifyTurnstile } from "../lib/turnstile";

/**
 * The landing page's launch waitlist. Joining answers the same whether or not
 * the email was already on it, so nobody can probe the list for addresses.
 * Behind Turnstile and a per-IP limit; the list is only for the launch email.
 */
export const waitlistRoutes = new Hono<AppEnv>().post(
  "/waitlist",
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => fail(c, 413, "too_large") }),
  async (c) => {
    const ip = clientIp(c);
    const { success } = await c.env.WAITLIST_LIMITER.limit({ key: `waitlist:${ip}` });
    if (!success) return fail(c, 429, "rate_limited", "Too many tries. Try again in a minute.");

    const parsed = joinWaitlistSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return fail(c, 400, "invalid_email", "That doesn't look like an email address.");
    }
    const { email, turnstileToken } = parsed.data;
    // Locally, Turnstile's test keys stand in, and a missing widget is fine.
    const verified = turnstileToken
      ? await verifyTurnstile(c.env, turnstileToken, ip, "waitlist")
      : c.env.ENVIRONMENT === "development";
    if (!verified) {
      return fail(c, 403, "turnstile_failed", "We couldn't verify you're human. Please try again.");
    }

    await getDb(c.env.DB)
      .insert(waitlist)
      .values({ email, createdAt: Date.now() })
      .onConflictDoNothing();
    return c.json<JoinWaitlistResult>({ ok: true });
  },
);
