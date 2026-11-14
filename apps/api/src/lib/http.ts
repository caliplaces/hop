import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function fail(c: Context, status: ContentfulStatusCode, error: string, message?: string) {
  return c.json({ error, ...(message ? { message } : {}) }, status);
}

export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
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
