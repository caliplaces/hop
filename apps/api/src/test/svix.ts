/** Signs webhooks as Resend does (the Svix scheme), for tests. */

export const WEBHOOK_SECRET = `whsec_${btoa("hop's test webhook signing secret")}`;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export async function signature(
  body: string,
  { secret = WEBHOOK_SECRET, id = "msg_1", timestamp = Math.floor(Date.now() / 1000) } = {},
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.slice("whsec_".length)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${body}`));
  return `v1,${toBase64(new Uint8Array(mac))}`;
}

/** The headers Resend sends with a webhook. */
export async function svixHeaders(
  body: string,
  options: { secret?: string; id?: string; timestamp?: number } = {},
): Promise<Record<string, string>> {
  const id = options.id ?? "msg_1";
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": await signature(body, { ...options, id, timestamp }),
  };
}

/** An email event as Resend sends it, for an email production sent unless `data` says otherwise. */
export function emailEvent(
  type: string,
  data: Record<string, unknown> = {},
  from = "Hop <hello@onmyhop.com>",
) {
  return {
    type,
    created_at: "2026-11-17T12:00:00.000Z",
    data: {
      created_at: "2026-11-17T11:59:59.000Z",
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      from,
      to: ["alex@example.com"],
      subject: "1 clip leaves your inbox on Monday 23 November",
      tags: { category: "clips-expiring", env: "production" },
      ...data,
    },
  };
}
