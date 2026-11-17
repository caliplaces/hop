import { normalizeAddress, type SuppressionReason } from "./suppressions";

/**
 * Resend's webhook (routes/email.ts): which of its events mean an email
 * never arrived, and which mean an address can't, or mustn't, be emailed
 * again.
 *
 * Resend signs each request the way Svix does: an HMAC-SHA256, with the
 * endpoint's signing secret, of the message ID, its timestamp and the body
 * as received, in the svix-id, svix-timestamp and svix-signature headers.
 */

/** How far a webhook's timestamp may be from now, either way, as in Svix's own libraries. */
const TOLERANCE_S = 5 * 60;
/**
 * Signatures read from one header: Svix sends one, or two while a secret is
 * being rolled. More are ignored, so a forged header can't make much work.
 */
const MAX_SIGNATURES = 5;
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

type TimingSafe = { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };

/**
 * Whether two byte strings are equal, taking as long whatever they hold:
 * Workers' crypto.subtle.timingSafeEqual where there is one, otherwise
 * (Node, in tests) every byte compared.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const subtle = crypto.subtle as SubtleCrypto & TimingSafe;
  if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(a, b);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

export type SvixHeaders = {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
};

/**
 * Whether a webhook is Resend's: one of the first few v1 signatures in
 * svix-signature (two while the secret is being rolled) is the HMAC of
 * `${id}.${timestamp}.${body}` with the secret (`whsec_` and base64), and
 * the timestamp is recent, so it can't be replayed later. The HMAC is made
 * once, and compared with each signature in constant time.
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
    ["sign"],
  );
  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  let match = false;
  for (const part of signature.split(" ").slice(0, MAX_SIGNATURES)) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const mac = fromBase64(part.slice(comma + 1));
    // Every candidate is compared, a match or not.
    if (mac && equalBytes(mac, expected)) match = true;
  }
  return match;
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

/** A tag's value, in either shape Resend uses: an object, or a list of names and values. */
function tagValue(tags: unknown, name: string): unknown {
  if (Array.isArray(tags)) {
    return (tags as { name?: unknown; value?: unknown }[]).find((tag) => tag?.name === name)?.value;
  }
  return tags && typeof tags === "object" ? (tags as Record<string, unknown>)[name] : undefined;
}

export type ResendNews = {
  /** Resend's ID for an email that never arrived: a notice it gave no longer counts. */
  undelivered: string | null;
  /** Addresses Hop stops emailing, and why. */
  suppress: { addresses: string[]; reason: SuppressionReason } | null;
};

/**
 * What an event means, if anything:
 *   email.bounced     it never arrived; for good (permanent) the address is
 *                     dead too, otherwise (temporary) a later email may get there
 *   email.failed      it was never sent (a quota, say); the address may be fine
 *   email.suppressed  it was never sent: the address is on Resend's
 *                     account-wide suppression list
 *   email.complained  it arrived, and its owner reported it as spam
 * Every other event means nothing here. Only emails this environment sent
 * count: from Hop's `domain` (the Resend account sends for other products
 * too), tagged `env` with `environment` (staging and production share the
 * account, and both webhooks hear of every email).
 */
export function readResendEvent(
  event: unknown,
  { domain, environment }: { domain: string; environment: string },
): ResendNews | null {
  if (!event || typeof event !== "object") return null;
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (!data || typeof data !== "object") return null;
  const fields = data as {
    from?: unknown;
    to?: unknown;
    email_id?: unknown;
    bounce?: unknown;
    tags?: unknown;
  };
  if (!domain || domainOf(fields.from) !== domain) return null;
  if (!environment || tagValue(fields.tags, "env") !== environment) return null;

  const emailId =
    typeof fields.email_id === "string" && fields.email_id && fields.email_id.length <= 128
      ? fields.email_id
      : null;
  const to = Array.isArray(fields.to) ? fields.to : [fields.to];
  const addresses = [
    ...new Set(
      to
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeAddress(bareAddress(value)))
        .filter(isAddress),
    ),
  ].slice(0, MAX_ADDRESSES);
  const stop = (reason: SuppressionReason) => (addresses.length > 0 ? { addresses, reason } : null);

  switch (type) {
    case "email.bounced": {
      const bounce = fields.bounce as { type?: unknown } | null | undefined;
      return {
        undelivered: emailId,
        suppress: bounce?.type === "Permanent" ? stop("bounced") : null,
      };
    }
    case "email.failed":
      return { undelivered: emailId, suppress: null };
    case "email.suppressed":
      return { undelivered: emailId, suppress: stop("suppressed") };
    case "email.complained":
      return { undelivered: null, suppress: stop("complained") };
    default:
      return null;
  }
}
