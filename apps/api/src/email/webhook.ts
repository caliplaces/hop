import { normalizeAddress, type SuppressionReason } from "./suppressions";

/**
 * Resend's webhook (routes/email.ts): which of its events mean an address
 * can't, or mustn't, be emailed again.
 *
 * Resend signs each request the way Svix does: an HMAC-SHA256, with the
 * endpoint's signing secret, of the message ID, its timestamp and the body
 * as received, in the svix-id, svix-timestamp and svix-signature headers.
 */

/** How far a webhook's timestamp may be from now, either way, as in Svix's own libraries. */
const TOLERANCE_S = 5 * 60;
/**
 * At most this many addresses from one event: Hop sends each email to one,
 * and storing them stays within D1's 100 bound values a statement.
 */
const MAX_ADDRESSES = 20;

const encoder = new TextEncoder();

function fromBase64(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(input);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export type SvixHeaders = {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
};

/**
 * Whether a webhook is Resend's: one of the v1 signatures in svix-signature
 * (several while the secret is being rolled) is the HMAC of
 * `${id}.${timestamp}.${body}` with the secret (`whsec_` and base64), and
 * the timestamp is recent, so it can't be replayed later.
 */
export async function verifyResendWebhook(
  secret: string,
  headers: SvixHeaders,
  body: Uint8Array,
  now = Date.now(),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || id.length > 256 || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  if (!secret.startsWith("whsec_")) return false;
  const keyBytes = fromBase64(secret.slice("whsec_".length));
  if (!keyBytes || keyBytes.length === 0) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const mac = fromBase64(part.slice(comma + 1));
    // Constant time: SubtleCrypto compares the HMAC itself.
    if (mac?.length === 32 && (await crypto.subtle.verify("HMAC", key, mac, signed))) {
      return true;
    }
  }
  return false;
}

/** The address in "Name <address>", or the string itself. */
function bareAddress(value: string): string {
  const angled = value.match(/<([^<>]*)>\s*$/);
  return (angled?.[1] ?? value).trim();
}

/** The domain an address (or "Name <address>") is at, lowercased; "" if none. */
export function domainOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const address = bareAddress(value);
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(at + 1).toLowerCase();
}

function isAddress(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
}

export type Undeliverable = { addresses: string[]; reason: SuppressionReason };

/**
 * What an event means for whom, if anything:
 *   email.bounced, permanent   the mail server refused it for good
 *   email.complained           its owner reported it as spam
 *   email.suppressed           Resend didn't send it: the address is on its
 *                              account's suppression list
 * Temporary bounces, and every other event, mean nothing here. Only emails
 * Hop sent count (from `domain`): the Resend account sends for other
 * products too.
 */
export function undeliverable(event: unknown, domain: string): Undeliverable | null {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (!data || typeof data !== "object") return null;
  const fields = data as { from?: unknown; to?: unknown; bounce?: unknown };
  if (!domain || domainOf(fields.from) !== domain) return null;

  let reason: SuppressionReason;
  if (type === "email.bounced") {
    const bounce = fields.bounce as { type?: unknown } | null | undefined;
    if (bounce?.type !== "Permanent") return null;
    reason = "bounced";
  } else if (type === "email.complained") {
    reason = "complained";
  } else if (type === "email.suppressed") {
    reason = "suppressed";
  } else {
    return null;
  }

  const to = Array.isArray(fields.to) ? fields.to : [fields.to];
  const addresses = [
    ...new Set(
      to
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeAddress(bareAddress(value)))
        .filter(isAddress),
    ),
  ].slice(0, MAX_ADDRESSES);
  return addresses.length > 0 ? { addresses, reason } : null;
}
