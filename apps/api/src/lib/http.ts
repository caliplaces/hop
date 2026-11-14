import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function fail(c: Context, status: ContentfulStatusCode, error: string, message?: string) {
  return c.json({ error, ...(message ? { message } : {}) }, status);
}

export function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

/** Only allow same-site relative redirects like "/app". */
export function safeReturnTo(input: string | undefined | null, fallback = "/app"): string {
  if (!input?.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) {
    return fallback;
  }
  return input;
}

export function isSecureUrl(url: string): boolean {
  return url.startsWith("https://");
}
