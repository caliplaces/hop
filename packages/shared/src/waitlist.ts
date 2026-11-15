import { z } from "zod";

/**
 * Launch-day waitlist sign-up from the landing page. Emails are compared
 * lowercased, so signing up twice with different casing is one entry.
 */
export const waitlistEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const joinWaitlistSchema = z.object({
  email: waitlistEmailSchema,
  /** Cloudflare Turnstile token, minted with the "waitlist" action. */
  turnstileToken: z.string().max(2048).optional(),
});
export type JoinWaitlistInput = z.input<typeof joinWaitlistSchema>;

/** The same answer whether or not the email was already on the list. */
export type JoinWaitlistResult = { ok: true };
