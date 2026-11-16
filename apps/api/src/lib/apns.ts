import type { Env } from "../env";
import { base64url } from "./crypto";

/**
 * Apple Push Notification service, for Live Activity updates. Requests are
 * authenticated with a short JWT (ES256) signed by the .p8 key; see
 * https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 */

const HOSTS = {
  sandbox: "api.sandbox.push.apple.com",
  production: "api.push.apple.com",
} as const;

/**
 * Apple refuses provider tokens older than an hour, and throttles making new
 * ones more often than every 20 minutes. This isolate's token is reused for 50.
 */
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
let cached: { keyId: string; value: string; issuedAt: number } | null = null;

/** The key's DER bytes from its PEM, with or without the header lines and line breaks. */
function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A provider token for APNs, reused while it's fresh. */
export async function providerToken(env: Env, now = Date.now()): Promise<string> {
  if (cached && cached.keyId === env.APNS_KEY_ID && now - cached.issuedAt < TOKEN_LIFETIME_MS) {
    return cached.value;
  }
  if (!env.APNS_KEY) throw new Error("APNS_KEY isn't set");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(env.APNS_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "ES256", kid: env.APNS_KEY_ID })}.${encode({
    iss: env.APPLE_TEAM_ID,
    iat: Math.floor(now / 1000),
  })}`;
  // Web Crypto's ECDSA signature is already JWS's raw r‖s form.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const value = `${unsigned}.${base64url(new Uint8Array(signature))}`;
  cached = { keyId: env.APNS_KEY_ID, value, issuedAt: now };
  return value;
}

/** Forgets the cached provider token, as when Apple says it has expired. Also for tests. */
export function forgetProviderToken() {
  cached = null;
}

/** What Event mode's Live Activity shows; the keys match the app's ContentState. */
export type EventActivityState = { clips: number; latest: string | null };

export type PushOutcome =
  /** Apple accepted it. */
  | "sent"
  /** The token is no longer valid (the Live Activity ended): stop using it. */
  | "gone"
  /** Something else went wrong; try again with the next clip. */
  | "failed";

/** Push tokens Apple has stopped accepting. */
const GONE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

/**
 * Updates one Live Activity. With `alert`, the update also lights up the
 * screen and expands the Dynamic Island, silently.
 */
export async function pushLiveActivity(
  env: Env,
  token: string,
  state: EventActivityState,
  { alert, now = Date.now() }: { alert?: { title: string; body: string }; now?: number } = {},
): Promise<PushOutcome> {
  const payload = {
    aps: {
      // Lets the device drop an update that arrives after a newer one.
      timestamp: Math.floor(now / 1000),
      event: "update",
      "content-state": state,
      ...(alert ? { alert } : {}),
    },
  };
  const response = await fetch(`https://${HOSTS[env.APNS_ENVIRONMENT]}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken(env, now)}`,
      "apns-push-type": "liveactivity",
      "apns-topic": `${env.APPLE_BUNDLE_ID}.push-type.liveactivity`,
      // Immediate. The app asks for frequent updates (NSSupportsLiveActivitiesFrequentUpdates).
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.ok) return "sent";
  const reason = ((await response.json().catch(() => null)) as { reason?: string } | null)?.reason;
  if (response.status === 410 || (reason && GONE_REASONS.has(reason))) return "gone";
  if (reason === "ExpiredProviderToken") forgetProviderToken();
  console.error("apns: push failed", response.status, reason);
  return "failed";
}

export type PushAlertOptions = {
  /** Rides along for the app, to open the right screen. */
  data: Record<string, string>;
  /** Notifications sharing it replace each other on the phone. */
  collapseId?: string;
  /** Notifications sharing it are grouped together on the phone. */
  threadId?: string;
  now?: number;
};

/**
 * A notification on the phone (the app's own push token, not a Live
 * Activity's), such as new clips or clips about to expire.
 *
 * Only Apple's 410 (the app is gone from that phone) counts as "gone". A 400
 * such as DeviceTokenNotForTopic or BadDeviceToken is more likely this
 * server's setup (bundle ID, key, environment) than the phone, so the token
 * is kept and the problem logged; tokens nobody refreshes expire anyway.
 */
export async function pushAlert(
  env: Env,
  token: string,
  alert: { title: string; body: string },
  { data, collapseId, threadId, now = Date.now() }: PushAlertOptions,
): Promise<PushOutcome> {
  const response = await fetch(`https://${HOSTS[env.APNS_ENVIRONMENT]}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken(env, now)}`,
      "apns-push-type": "alert",
      "apns-topic": env.APPLE_BUNDLE_ID,
      "apns-priority": "10",
      ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert, sound: "default", ...(threadId ? { "thread-id": threadId } : {}) },
      ...data,
    }),
  });
  if (response.ok) return "sent";
  if (response.status === 410) return "gone";
  const reason = ((await response.json().catch(() => null)) as { reason?: string } | null)?.reason;
  if (reason === "ExpiredProviderToken") forgetProviderToken();
  console.error("apns: alert failed", response.status, reason);
  return "failed";
}
