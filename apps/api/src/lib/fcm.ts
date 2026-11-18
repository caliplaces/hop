import type { Env } from "../env";
import type { PushAlertOptions, PushOutcome } from "./apns";
import { base64url, pkcs8 } from "./crypto";

/**
 * Firebase Cloud Messaging, for the Android app: its notifications and Event
 * mode's count. Requests are authorized with an OAuth access token, which a
 * service account gets by signing a short JWT (RS256) with its key; see
 * https://firebase.google.com/docs/cloud-messaging/send/v1-api
 *
 * Every message is a data message. The app builds the notification itself,
 * in its own channels and colours, and drops any meant for an account that
 * has since signed out of that phone (see `recipient`).
 */

/** What Hop needs of the service account's key file (JSON, from Google Cloud). */
export type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
};

/** An FCM registration token: URL-safe base64 with a colon, about 160 characters today. */
export const FCM_TOKEN = /^[0-9A-Za-z_:-]{32,1024}$/;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Google's access tokens last an hour; this isolate's is reused for 50 minutes. */
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
/** A request Google hasn't answered in this long is given up on, so it can't hold up a run. */
const TIMEOUT_MS = 10 * 1000;

let parsed: { raw: string; account: ServiceAccount | null } | null = null;

/** The service account in FCM_SERVICE_ACCOUNT, or null without one (nothing goes to Android then). */
export function serviceAccount(env: Env): ServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (parsed?.raw === raw) return parsed.account;
  let account: ServiceAccount | null = null;
  try {
    const json = JSON.parse(raw) as Partial<ServiceAccount>;
    if (
      typeof json.project_id === "string" &&
      typeof json.client_email === "string" &&
      typeof json.private_key === "string"
    ) {
      account = {
        project_id: json.project_id,
        client_email: json.client_email,
        private_key: json.private_key,
        private_key_id: typeof json.private_key_id === "string" ? json.private_key_id : undefined,
      };
    }
  } catch {
    // Reported below.
  }
  // Never the key itself in the logs.
  if (!account) console.error("fcm: FCM_SERVICE_ACCOUNT isn't a service account key file");
  parsed = { raw, account };
  return account;
}

let cached: { email: string; token: Promise<string>; issuedAt: number } | null = null;

/**
 * An access token for FCM, reused while it's fresh. Pushes to several phones
 * at once share one request for it.
 */
export function accessToken(account: ServiceAccount, now = Date.now()): Promise<string> {
  if (
    cached &&
    cached.email === account.client_email &&
    now - cached.issuedAt < TOKEN_LIFETIME_MS
  ) {
    return cached.token;
  }
  const entry = { email: account.client_email, token: requestToken(account, now), issuedAt: now };
  cached = entry;
  // A failed request isn't kept: the next push asks again.
  entry.token.catch(() => {
    if (cached === entry) cached = null;
  });
  return entry.token;
}

/** Forgets the cached access token, as when Google refuses it. Also for tests. */
export function forgetAccessToken() {
  cached = null;
}

async function requestToken(account: ServiceAccount, now: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const iat = Math.floor(now / 1000);
  const unsigned = `${encode({
    alg: "RS256",
    typ: "JWT",
    ...(account.private_key_id ? { kid: account.private_key_id } : {}),
  })}.${encode({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof body?.access_token !== "string") {
    throw new Error(`fcm: access token refused (${response.status}, ${String(body?.error)})`);
  }
  return body.access_token;
}

type Message = {
  /** For the app; FCM only carries strings. */
  data: Record<string, string>;
  /** While the phone is offline, a newer message with the same key replaces an older one. */
  collapseKey?: string;
};

type FcmErrorDetail = {
  "@type"?: string;
  errorCode?: string;
  fieldViolations?: { field?: string }[];
};

/**
 * Whether FCM says the token is no good: UNREGISTERED (the app is gone from
 * the phone, or the token expired), or INVALID_ARGUMENT about the token
 * itself (it was never one).
 */
function tokenGone(code: string | undefined, details: FcmErrorDetail[]): boolean {
  if (code === "UNREGISTERED") return true;
  return (
    code === "INVALID_ARGUMENT" &&
    details.some(
      (detail) =>
        detail["@type"]?.endsWith("google.rpc.BadRequest") &&
        detail.fieldViolations?.some((violation) => violation.field === "message.token"),
    )
  );
}

/**
 * Who a message is for, as the app on that phone can tell: a hash of the
 * account and the token, so Google gets no account ID to link phones by.
 */
export async function recipient(userId: string, token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${userId}:${token}`),
  );
  return base64url(new Uint8Array(digest)).slice(0, 22);
}

/**
 * Sends one data message, at high priority so it's delivered at once, even
 * in Doze: each one ends up on the screen (a notification, or the count on
 * Event mode's).
 *
 * Only a token FCM says is no good counts as "gone". Other errors, such as
 * SENDER_ID_MISMATCH, are more likely this server's setup than the phone, so
 * the token is kept and the problem logged; tokens nobody refreshes expire anyway.
 */
async function send(
  env: Env,
  token: string,
  { data, collapseKey }: Message,
  now: number,
): Promise<PushOutcome> {
  const account = serviceAccount(env);
  if (!account) return "failed";
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken(account, now)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          data,
          android: { priority: "high", ...(collapseKey ? { collapse_key: collapseKey } : {}) },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (response.ok) return "sent";
  const error = (
    (await response.json().catch(() => null)) as {
      error?: { status?: string; details?: FcmErrorDetail[] };
    } | null
  )?.error;
  const details = Array.isArray(error?.details) ? error.details : [];
  const code =
    details.find((detail) => detail["@type"]?.endsWith("google.firebase.fcm.v1.FcmError"))
      ?.errorCode ?? error?.status;
  if (tokenGone(code, details)) return "gone";
  if (response.status === 401) forgetAccessToken();
  console.error("fcm: push failed", response.status, code);
  return "failed";
}

/**
 * A notification on an Android phone, such as new clips or clips about to
 * expire: the same text as on the iPhone, and the same `data` to open the
 * right screen. `userId` is the account it's for.
 */
export async function pushFcmAlert(
  env: Env,
  token: string,
  userId: string,
  alert: { title: string; body: string },
  { data, collapseId, threadId, now = Date.now() }: PushAlertOptions,
): Promise<PushOutcome> {
  return send(
    env,
    token,
    {
      data: {
        ...data,
        recipient: await recipient(userId, token),
        title: alert.title,
        body: alert.body,
        // Grouped together on the phone, and replacing each other, as on the iPhone.
        ...(threadId ? { group: threadId } : {}),
        ...(collapseId ? { tag: collapseId } : {}),
      },
      collapseKey: collapseId,
    },
    now,
  );
}

/**
 * Event mode's count on an Android phone: clips since it started, and who
 * sent the latest. With `alert`, the app also lets the phone know (once
 * every few minutes, as on the iPhone).
 */
export async function pushFcmEventUpdate(
  env: Env,
  token: string,
  {
    userId,
    hopId,
    clips,
    latest,
    alert,
    now = Date.now(),
  }: {
    userId: string;
    hopId: string;
    clips: number;
    latest: string | null;
    alert: boolean;
    now?: number;
  },
): Promise<PushOutcome> {
  return send(
    env,
    token,
    {
      data: {
        hop: "event",
        recipient: await recipient(userId, token),
        hopId,
        clips: String(clips),
        ...(latest ? { latest } : {}),
        // Lets the app drop an update that arrives after a newer one.
        at: String(now),
        ...(alert ? { alert: "1" } : {}),
      },
      // Only the newest count matters to a phone that was offline.
      collapseKey: `event:${hopId}`,
    },
    now,
  );
}
