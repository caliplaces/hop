import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function fail(c: Context, status: ContentfulStatusCode, error: string, message?: string) {
  return c.json({ error, ...(message ? { message } : {}) }, status);
}

export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/**
 * Who to rate limit, by IP: the address, or for IPv6 its /64, which one
 * home or phone usually gets whole. Limiting per IPv6 address would let
 * anyone pick a fresh one for every request.
 */
export function ipRateKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Turn a user-supplied return path into a same-origin path. Resolving it as a
 * URL (rather than string checks) also catches tricks like "/\t/evil.example",
 * which browsers normalise to "//evil.example".
 */
export function safeReturnTo(
  input: string | undefined | null,
  appUrl: string,
  fallback = "/app",
): string {
  if (!input?.startsWith("/")) return fallback;
  try {
    const origin = new URL(appUrl).origin;
    const url = new URL(input, origin);
    if (url.origin !== origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function isSecureUrl(url: string): boolean {
  return url.startsWith("https://");
}

export class BodyTooLargeError extends Error {}

/**
 * Read a request body without ever buffering more than `maxBytes`. Requires a
 * Content-Length header (browsers always send one for Blob bodies).
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > maxBytes || !request.body) {
    throw new BodyTooLargeError();
  }
  const out = new Uint8Array(declared);
  let offset = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > declared) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    out.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== declared) throw new BodyTooLargeError();
  return out;
}
