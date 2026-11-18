import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { devices, files, hops, liveActivities, sessions, users } from "./db/schema";
import type { Env } from "./env";
import worker from "./index";
import { forgetProviderToken } from "./lib/apns";
import { fromBase64url, randomToken, sha256Hex } from "./lib/crypto";
import { forgetAccessToken, pushFcmAlert, serviceAccount } from "./lib/fcm";
import { pushToPhones } from "./lib/phones";
import { ALERT_EVERY_MS, pushArrivals } from "./live";
import { announceNewClips } from "./notify";
import { createTestD1 } from "./test/d1";

const T0 = Date.UTC(2026, 10, 18, 12);
const MIN = 60 * 1000;
/** Shaped like FCM's registration tokens: URL-safe base64, a colon, mixed case. */
const PHONE = `cPhone1:Fcm_${"Ab-Cd_Ef".repeat(18)}`;
const OTHER_PHONE = `dPhone2:Fcm_${"Gh-Ij_Kl".repeat(18)}`;
const IPHONE = "a1".repeat(32);
const ACCESS_TOKEN = "test-access-token";

let keys: CryptoKeyPair;
let account: string;
let env: Env;
let db: ReturnType<typeof getDb>;
let session: string;
/** Every access token request, and every message sent to FCM and APNs. */
let tokenRequests: URLSearchParams[];
let messages: {
  url: string;
  authorization: string;
  message: {
    token: string;
    data: Record<string, string>;
    android: { priority: string; collapse_key?: string };
  };
}[];
let apns: string[];
let tokenReply: () => Response;
let fcmReply: (token: string) => Response;

const fcmError = (status: number, code: string, errorCode?: string) =>
  Response.json(
    {
      error: {
        code: status,
        status: code,
        details: errorCode
          ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }]
          : [],
      },
    },
    { status },
  );

async function pem(key: CryptoKey) {
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", key)) as ArrayBuffer);
  const base64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  // As Google Cloud hands it out, line breaks escaped in the JSON.
  account = JSON.stringify({
    type: "service_account",
    project_id: "hop-test",
    private_key_id: "key-1",
    private_key: await pem(keys.privateKey),
    client_email: "push@hop-test.iam.gserviceaccount.com",
  });
});

beforeEach(async () => {
  forgetAccessToken();
  forgetProviderToken();
  const apnsKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    APNS_KEY: await pem(apnsKeys.privateKey),
    APNS_KEY_ID: "KEY1234567",
    APNS_ENVIRONMENT: "sandbox",
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_BUNDLE_ID: "com.onmyhop.app",
    FCM_SERVICE_ACCOUNT: account,
    PROFILE_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  db = getDb(DB);
  await db.insert(users).values([
    { id: "usr_a", oidcSub: "sub-a", handle: "alex", createdAt: T0, updatedAt: T0 },
    { id: "usr_b", oidcSub: "sub-b", handle: "blake", createdAt: T0, updatedAt: T0 },
  ]);
  await db.insert(hops).values([
    { id: "hop_jam", ownerId: "usr_a", slug: "jam", title: "Jam", createdAt: T0 },
    { id: "hop_theirs", ownerId: "usr_b", slug: "theirs", title: "Theirs", createdAt: T0 },
  ]);
  session = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(session),
    userId: "usr_a",
    kind: "app",
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * MIN,
  });

  tokenRequests = [];
  messages = [];
  apns = [];
  tokenReply = () => Response.json({ access_token: ACCESS_TOKEN, expires_in: 3599 });
  fcmReply = () => Response.json({ name: "projects/hop-test/messages/1" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const host = new URL(url).hostname;
      if (host === "oauth2.googleapis.com") {
        tokenRequests.push(new URLSearchParams(init.body as string));
        return tokenReply();
      }
      if (host === "fcm.googleapis.com") {
        const { message } = JSON.parse(init.body as string);
        messages.push({
          url,
          authorization: (init.headers as Record<string, string>).authorization ?? "",
          message,
        });
        return fcmReply(message.token);
      }
      if (host === "api.sandbox.push.apple.com" || host === "api.push.apple.com") {
        apns.push(url.split("/").at(-1) ?? "");
        return new Response(null, { status: 200 });
      }
      // Resend, for the new-clips email.
      return Response.json({ id: "email_1" });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function call(path: string, init: RequestInit = {}) {
  const request = new Request(`https://onmyhop.com/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
  });
  return worker.fetch(request, env, {} as ExecutionContext);
}

async function phone(token: string, platform: "apns" | "fcm", environment = "sandbox") {
  await db.insert(devices).values({
    token,
    userId: "usr_a",
    platform,
    environment: environment as "sandbox" | "production",
    createdAt: T0,
    updatedAt: T0,
  });
}

async function clip(completedAt: number, from: string | null = "Mia") {
  const id = `fil_${randomToken(6)}`;
  await db.insert(files).values({
    id,
    hopId: "hop_jam",
    ownerId: "usr_a",
    r2Key: `hops/hop_jam/${id}`,
    originalName: "IMG.MOV",
    mime: "video/quicktime",
    size: 1000,
    partSize: 1000,
    partCount: 1,
    status: "complete",
    passId: "pass",
    uploadTokenHash: "x",
    contributorName: from,
    createdAt: completedAt - MIN,
    lastActivityAt: completedAt,
    completedAt,
  });
}

const alert = { title: "2 new clips", body: "From Mia and Leo, in Jam" };
const decode = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64url(part)));

describe("the FCM sender", () => {
  it("signs in as the service account, and reuses its access token for 50 minutes", async () => {
    expect(
      await pushFcmAlert(env, PHONE, "usr_a", alert, { data: { hop: "clips" }, now: T0 }),
    ).toBe("sent");
    expect(tokenRequests).toHaveLength(1);
    const request = tokenRequests[0];
    expect(request?.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header = "", claims = "", signature = ""] = request?.get("assertion")?.split(".") ?? [];
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
    expect(decode(claims)).toEqual({
      iss: "push@hop-test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: T0 / 1000,
      exp: T0 / 1000 + 3600,
    });
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        keys.publicKey,
        fromBase64url(signature),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
    ).toBe(true);
    expect(messages[0]?.url).toBe("https://fcm.googleapis.com/v1/projects/hop-test/messages:send");
    expect(messages[0]?.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    await pushFcmAlert(env, PHONE, "usr_a", alert, { data: { hop: "clips" }, now: T0 + 49 * MIN });
    expect(tokenRequests).toHaveLength(1);
    await pushFcmAlert(env, PHONE, "usr_a", alert, { data: { hop: "clips" }, now: T0 + 51 * MIN });
    expect(tokenRequests).toHaveLength(2);
  });

  it("asks once for phones pushed to at the same time", async () => {
    await Promise.all(
      [PHONE, OTHER_PHONE, PHONE].map((token) =>
        pushFcmAlert(env, token, "usr_a", alert, { data: { hop: "clips" }, now: T0 }),
      ),
    );
    expect(tokenRequests).toHaveLength(1);
    expect(messages).toHaveLength(3);
  });

  it("asks again after Google refuses an access token request", async () => {
    tokenReply = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    await expect(
      pushFcmAlert(env, PHONE, "usr_a", alert, { data: { hop: "clips" }, now: T0 }),
    ).rejects.toThrow("access token refused (400, invalid_grant)");
    expect(messages).toHaveLength(0);
    tokenReply = () => Response.json({ access_token: ACCESS_TOKEN, expires_in: 3599 });
    expect(
      await pushFcmAlert(env, PHONE, "usr_a", alert, { data: { hop: "clips" }, now: T0 + MIN }),
    ).toBe("sent");
    expect(tokenRequests).toHaveLength(2);
  });

  it("asks for a new access token when FCM turns its token down", async () => {
    fcmReply = () => fcmError(401, "UNAUTHENTICATED");
    expect(await pushFcmAlert(env, PHONE, "usr_a", alert, { data: {}, now: T0 })).toBe("failed");
    fcmReply = () => Response.json({ name: "projects/hop-test/messages/2" });
    expect(await pushFcmAlert(env, PHONE, "usr_a", alert, { data: {}, now: T0 + MIN })).toBe(
      "sent",
    );
    expect(tokenRequests).toHaveLength(2);
  });

  it("calls a token gone only when FCM says it's unregistered", async () => {
    const outcome = async (reply: Response) => {
      fcmReply = () => reply;
      return pushFcmAlert(env, PHONE, "usr_a", alert, { data: {}, now: T0 });
    };
    expect(await outcome(fcmError(404, "NOT_FOUND", "UNREGISTERED"))).toBe("gone");
    // This server's setup, more likely than the phone: kept, and logged.
    expect(await outcome(fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"))).toBe("failed");
    expect(await outcome(fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"))).toBe("failed");
    expect(await outcome(fcmError(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"))).toBe("failed");
    expect(await outcome(new Response("Service Unavailable", { status: 503 }))).toBe("failed");
  });

  it("does without a key file it can't read, and never logs it", async () => {
    const error = vi.mocked(console.error);
    for (const broken of ["not json", JSON.stringify({ project_id: "hop-test" }), "[]"]) {
      expect(serviceAccount({ ...env, FCM_SERVICE_ACCOUNT: broken })).toBeNull();
    }
    expect(serviceAccount({ ...env, FCM_SERVICE_ACCOUNT: undefined })).toBeNull();
    expect(serviceAccount(env)?.project_id).toBe("hop-test");
    expect(JSON.stringify(error.mock.calls)).not.toContain("hop-test");
  });
});

describe("Android phones", () => {
  const put = (token: string, body: Record<string, unknown>) =>
    call(`/me/devices/${encodeURIComponent(token)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  const remove = (token: string) =>
    call(`/me/devices/${encodeURIComponent(token)}`, { method: "DELETE" });

  it("register their FCM token as given, and remove it on sign-out", async () => {
    expect((await put(PHONE, { platform: "fcm" })).status).toBe(200);
    expect(await db.select().from(devices).get()).toMatchObject({
      token: PHONE,
      userId: "usr_a",
      platform: "fcm",
      environment: "production",
    });
    // FCM tokens are case-sensitive: another case is another token.
    await remove(PHONE.toLowerCase());
    expect(await db.select().from(devices)).toHaveLength(1);
    await remove(PHONE);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("refuse what isn't an FCM token", async () => {
    expect((await put("too-short", { platform: "fcm" })).status).toBe(400);
    expect((await put(`${PHONE}.x`, { platform: "fcm" })).status).toBe(400);
    expect((await put(`${PHONE}/x`, { platform: "fcm" })).status).toBe(400);
    expect((await put(PHONE, { platform: "android" })).status).toBe(400);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("never turn an iPhone's token into an Android one", async () => {
    await phone(IPHONE, "apns");
    expect((await put(IPHONE, { platform: "fcm" })).status).toBe(409);
    expect(await db.select().from(devices).get()).toMatchObject({ platform: "apns" });
  });

  it("still let the iPhone app register without saying its platform", async () => {
    expect((await put(IPHONE.toUpperCase(), { environment: "sandbox" })).status).toBe(200);
    expect(await db.select().from(devices).get()).toMatchObject({
      token: IPHONE,
      platform: "apns",
      environment: "sandbox",
    });
    expect((await put(IPHONE, { platform: "apns" })).status).toBe(400);
  });

  it("get notifications alongside iPhones, as data for the app to show", async () => {
    await phone(PHONE, "fcm", "production");
    await phone(IPHONE, "apns");
    // An iPhone on the other APNs environment can't be reached.
    await phone("b2".repeat(32), "apns", "production");
    const sent = await pushToPhones(env, db, "usr_a", alert, {
      data: { hop: "clips", hopId: "hop_jam" },
      threadId: "hop_jam",
      now: T0,
    });
    expect(sent).toBe(true);
    expect(apns).toEqual([IPHONE]);
    expect(messages.map((sent) => sent.message)).toEqual([
      {
        token: PHONE,
        data: {
          hop: "clips",
          hopId: "hop_jam",
          user: "usr_a",
          title: alert.title,
          body: alert.body,
          group: "hop_jam",
        },
        android: { priority: "high" },
      },
    ]);
  });

  it("have a notice replace the one before it", async () => {
    await phone(PHONE, "fcm", "production");
    await pushToPhones(env, db, "usr_a", alert, {
      data: { hop: "expiring" },
      collapseId: "expiring",
      now: T0,
    });
    expect(messages[0]?.message.data.tag).toBe("expiring");
    expect(messages[0]?.message.android).toEqual({ priority: "high", collapse_key: "expiring" });
  });

  it("are forgotten when Google says the app is gone", async () => {
    await phone(PHONE, "fcm", "production");
    fcmReply = () => fcmError(404, "NOT_FOUND", "UNREGISTERED");
    expect(await pushToPhones(env, db, "usr_a", alert, { data: {}, now: T0 })).toBe(false);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("are only pushed to with a service account, iPhones only with an APNs key", async () => {
    await phone(PHONE, "fcm", "production");
    await phone(IPHONE, "apns");
    await pushToPhones({ ...env, FCM_SERVICE_ACCOUNT: undefined }, db, "usr_a", alert, {
      data: {},
      now: T0,
    });
    expect(messages).toEqual([]);
    expect(apns).toEqual([IPHONE]);
    await pushToPhones({ ...env, APNS_KEY: undefined }, db, "usr_a", alert, { data: {}, now: T0 });
    expect(messages).toHaveLength(1);
    expect(apns).toEqual([IPHONE]);
  });

  it("hear about new clips from a server that only has FCM", async () => {
    await db.update(users).set({ emailNewClips: false }).where(eq(users.id, "usr_a"));
    await phone(PHONE, "fcm", "production");
    await clip(T0 - 12 * MIN);
    await announceNewClips({ ...env, APNS_KEY: undefined }, T0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message.data).toMatchObject({ hop: "clips", user: "usr_a" });
  });
});

describe("Event mode on Android", () => {
  const register = (token: string, body: Record<string, unknown>) =>
    call(`/me/live-activities/${encodeURIComponent(token)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  const watch = () => register(PHONE, { hopId: "hop_jam", since: T0, platform: "fcm" });

  it("registers the app's FCM token for the event, and drops it when Event mode ends", async () => {
    expect((await watch()).status).toBe(200);
    expect(await db.select().from(liveActivities).get()).toMatchObject({
      token: PHONE,
      platform: "fcm",
      hopId: "hop_jam",
      since: T0,
    });
    await call(`/me/live-activities/${encodeURIComponent(PHONE.toLowerCase())}`, {
      method: "DELETE",
    });
    expect(await db.select().from(liveActivities)).toHaveLength(1);
    await call(`/me/live-activities/${encodeURIComponent(PHONE)}`, { method: "DELETE" });
    expect(await db.select().from(liveActivities)).toEqual([]);
  });

  it("refuses bad tokens, and a Live Activity's token as Android's", async () => {
    expect(
      (await register("too-short", { hopId: "hop_jam", since: T0, platform: "fcm" })).status,
    ).toBe(400);
    expect((await register(PHONE, { hopId: "hop_jam", since: T0 })).status).toBe(400);
    await db.insert(liveActivities).values({
      token: IPHONE,
      userId: "usr_a",
      hopId: "hop_jam",
      since: T0,
      createdAt: T0,
      expiresAt: T0 + 60 * MIN,
    });
    expect((await register(IPHONE, { hopId: "hop_jam", since: T0, platform: "fcm" })).status).toBe(
      409,
    );
    expect(await db.select().from(liveActivities).get()).toMatchObject({ platform: "apns" });
  });

  it("updates the count as clips land, letting the phone know at most every five minutes", async () => {
    await watch();
    await clip(T0 + MIN);
    await pushArrivals(env, "hop_jam", T0 + MIN);
    await clip(T0 + 2 * MIN, "Leo");
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    await clip(T0 + MIN + ALERT_EVERY_MS, null);
    await pushArrivals(env, "hop_jam", T0 + MIN + ALERT_EVERY_MS);
    expect(messages.map((sent) => sent.message)).toEqual([
      {
        token: PHONE,
        data: {
          hop: "event",
          user: "usr_a",
          hopId: "hop_jam",
          clips: "1",
          latest: "Mia",
          at: String(T0 + MIN),
          alert: "1",
        },
        android: { priority: "high", collapse_key: "event:hop_jam" },
      },
      {
        token: PHONE,
        data: {
          hop: "event",
          user: "usr_a",
          hopId: "hop_jam",
          clips: "2",
          latest: "Leo",
          at: String(T0 + 2 * MIN),
        },
        android: { priority: "high", collapse_key: "event:hop_jam" },
      },
      {
        token: PHONE,
        data: {
          hop: "event",
          user: "usr_a",
          hopId: "hop_jam",
          clips: "3",
          at: String(T0 + MIN + ALERT_EVERY_MS),
          alert: "1",
        },
        android: { priority: "high", collapse_key: "event:hop_jam" },
      },
    ]);
    // Counted on the phone: the new-clips push leaves these out.
    expect((await db.select().from(liveActivities).get())?.pushedAt).toBe(
      T0 + MIN + ALERT_EVERY_MS,
    );
  });

  it("hands the alert back when the update doesn't go through", async () => {
    await watch();
    await clip(T0 + MIN);
    fcmReply = () => fcmError(503, "UNAVAILABLE", "UNAVAILABLE");
    await pushArrivals(env, "hop_jam", T0 + MIN);
    expect(await db.select().from(liveActivities).get()).toMatchObject({
      alertedAt: null,
      pushedAt: null,
    });
    fcmReply = () => Response.json({ name: "projects/hop-test/messages/3" });
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    expect(messages.at(-1)?.message.data.alert).toBe("1");
  });

  it("forgets the token when Google says the app is gone", async () => {
    await watch();
    await clip(T0 + MIN);
    fcmReply = () => fcmError(404, "NOT_FOUND", "UNREGISTERED");
    await pushArrivals(env, "hop_jam", T0 + MIN);
    expect(await db.select().from(liveActivities)).toEqual([]);
  });

  it("updates Android phones only with a service account, iPhones only with an APNs key", async () => {
    await watch();
    await db.insert(liveActivities).values({
      token: IPHONE,
      userId: "usr_a",
      hopId: "hop_jam",
      since: T0,
      createdAt: T0,
      expiresAt: T0 + 60 * MIN,
    });
    await clip(T0 + MIN);
    await pushArrivals({ ...env, FCM_SERVICE_ACCOUNT: undefined }, "hop_jam", T0 + MIN);
    expect(messages).toEqual([]);
    expect(apns).toEqual([IPHONE]);
    await pushArrivals({ ...env, APNS_KEY: undefined }, "hop_jam", T0 + 2 * MIN);
    expect(messages).toHaveLength(1);
    expect(apns).toEqual([IPHONE]);
  });
});
