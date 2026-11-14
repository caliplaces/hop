import type { Env } from "../env";
import { signPayload, verifyPayload } from "../lib/crypto";

/** Where mail apps POST one-click unsubscribes (RFC 8058). Exempt from CSRF checks; see index.ts. */
export const ONE_CLICK_UNSUBSCRIBE_PATH = "/api/email/unsubscribe";

/** Links in old emails keep working for a year (the law asks for at least 30 days). */
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type UnsubscribeToken = {
  purpose: "unsubscribe";
  exp: number;
  userId: string;
  list: "new-clips";
};

export async function unsubscribeLinks(env: Env, userId: string) {
  const token = await signPayload<UnsubscribeToken>(env.SESSION_SECRET, {
    purpose: "unsubscribe",
    exp: Date.now() + TOKEN_TTL_MS,
    userId,
    list: "new-clips",
  });
  const query = `token=${encodeURIComponent(token)}`;
  return {
    /** The page a person lands on from the email's footer link; it asks before changing anything. */
    page: `${env.APP_URL}/unsubscribe?${query}`,
    /** For the List-Unsubscribe header: mail apps POST here directly. */
    oneClick: `${env.APP_URL}${ONE_CLICK_UNSUBSCRIBE_PATH}?${query}`,
  };
}

/** Headers that let mail apps show their own "Unsubscribe" button. */
export function listUnsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function verifyUnsubscribeToken(env: Env, token: string | null | undefined) {
  return verifyPayload<UnsubscribeToken>(env.SESSION_SECRET, token, "unsubscribe");
}
