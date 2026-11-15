import type { Env } from "../env";

/**
 * Action names set on the widget, checked so a token minted for one form
 * (or another site) doesn't count for another.
 */
export type TurnstileAction = "upload" | "waitlist";

type SiteverifyResponse = { success?: boolean; hostname?: string; action?: string };

export async function verifyTurnstile(
  env: Env,
  token: string,
  ip: string,
  action: TurnstileAction,
): Promise<boolean> {
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip !== "unknown") body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as SiteverifyResponse;
  if (data.success !== true) return false;
  // Cloudflare's test keys (used locally) report hostname "example.com" and no action.
  if (env.ENVIRONMENT === "development") return true;
  return data.hostname === new URL(env.APP_URL).hostname && data.action === action;
}
