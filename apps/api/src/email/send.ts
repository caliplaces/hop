import type { Env } from "../env";

const RESEND_API = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/** Resend refused the email; `code` is Resend's error name, e.g. "invalid_idempotent_request". */
export class ResendError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RenderedEmail = {
  subject: string;
  html: string;
  /** Plain-text alternative, for clients that don't render HTML and for spam filters. */
  text: string;
};

export type OutgoingEmail = RenderedEmail & {
  to: string;
  /**
   * Resend drops repeats of a key for 24 hours, so a retried request or cron
   * run can't send the same email twice. Make it unique per logical email.
   */
  idempotencyKey: string;
  /** Shows up in Resend's logs and analytics; letters, digits, _ and - only. */
  category: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
};

/**
 * Sends through Resend's HTTP API. Without an API key, local development
 * prints the email instead; anywhere else that's a misconfiguration.
 */
export async function sendEmail(env: Env, email: OutgoingEmail): Promise<void> {
  const subject = env.ENVIRONMENT === "staging" ? `[Staging] ${email.subject}` : email.subject;

  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT !== "development") throw new Error("RESEND_API_KEY is not set");
    console.log(`[email] to ${email.to}: ${subject}\n\n${email.text}`);
    return;
  }

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": email.idempotencyKey,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email.to],
      subject,
      html: email.html,
      text: email.text,
      tags: [{ name: "category", value: email.category }],
      headers: email.headers,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    // Resend's error body names the problem (bad sender, rate limit…) and never echoes the key.
    const body = (await response.json().catch(() => null)) as {
      name?: string;
      message?: string;
    } | null;
    throw new ResendError(
      response.status,
      body?.name ?? "unknown_error",
      `Resend rejected the email (${response.status}): ${body?.message ?? "no details"}`.slice(
        0,
        300,
      ),
    );
  }
}
