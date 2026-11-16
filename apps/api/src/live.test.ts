import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "./cron";
import { getDb } from "./db";
import { files, hops, liveActivities, sessions, users } from "./db/schema";
import type { Env } from "./env";
import worker from "./index";
import { forgetProviderToken } from "./lib/apns";
import { fromBase64url, randomToken, sha256Hex } from "./lib/crypto";
import { ALERT_EVERY_MS, pushArrivals } from "./live";
import { LIVE_ACTIVITIES_PER_USER } from "./routes/live";
import { createTestD1 } from "./test/d1";

const T0 = Date.UTC(2026, 10, 15, 12);
const MIN = 60 * 1000;
const TOKEN_A = "a1".repeat(40);
const TOKEN_B = "b2".repeat(40);

let env: Env;
let db: ReturnType<typeof getDb>;
let session: string;
let publicKey: CryptoKey;
/** Every request made to APNs. */
let pushes: {
  url: string;
  headers: Record<string, string>;
  body: { aps: Record<string, unknown> };
}[];
let apnsReply: (token: string) => Response;

async function pem(key: CryptoKey) {
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", key)) as ArrayBuffer);
  const base64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

beforeEach(async () => {
  forgetProviderToken();
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    APNS_KEY: await pem(pair.privateKey),
    APNS_KEY_ID: "KEY1234567",
    APNS_ENVIRONMENT: "sandbox",
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_BUNDLE_ID: "com.onmyhop.app",
  } as Env;
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

  pushes = [];
  apnsReply = () => new Response(null, { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      pushes.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      });
      return apnsReply(url.split("/").at(-1) ?? "");
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

const register = (token: string, body: Record<string, unknown>) =>
  call(`/me/live-activities/${token}`, { method: "PUT", body: JSON.stringify(body) });

async function clip(hopId: string, completedAt: number, from: string | null = "@mia") {
  const id = `fil_${randomToken(6)}`;
  await db.insert(files).values({
    id,
    hopId,
    ownerId: "usr_a",
    r2Key: `hops/${hopId}/${id}`,
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

async function watching(
  token: string,
  { since = T0, expiresAt = T0 + 12 * 60 * MIN, user = "usr_a" } = {},
) {
  await db.insert(liveActivities).values({
    token,
    userId: user,
    hopId: "hop_jam",
    since,
    createdAt: T0,
    expiresAt,
  });
}

describe("registering a Live Activity", () => {
  it("stores it for the athlete's own event, and refreshes it when registered again", async () => {
    expect(
      (await register(TOKEN_A, { hopId: "hop_jam", since: T0, environment: "sandbox" })).status,
    ).toBe(200);
    const first = await db.select().from(liveActivities).get();
    expect(first).toMatchObject({ token: TOKEN_A, userId: "usr_a", hopId: "hop_jam", since: T0 });

    expect(
      (await register(TOKEN_A, { hopId: "hop_jam", since: T0 + MIN, environment: "sandbox" }))
        .status,
    ).toBe(200);
    const rows = await db.select().from(liveActivities);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.since).toBe(T0 + MIN);
  });

  it("refuses bad tokens, someone else's event, and the other APNs environment", async () => {
    const ok = { hopId: "hop_jam", since: T0, environment: "sandbox" };
    expect((await register("not-hex", ok)).status).toBe(400);
    expect((await register("ab", ok)).status).toBe(400);
    expect((await register(TOKEN_A, { ...ok, hopId: "hop_theirs" })).status).toBe(404);
    expect((await register(TOKEN_A, { ...ok, environment: "production" })).status).toBe(409);
    expect((await register(TOKEN_A, { ...ok, since: -1 })).status).toBe(400);
    expect(await db.select().from(liveActivities)).toHaveLength(0);
  });

  it("never takes over another athlete's token", async () => {
    await watching(TOKEN_A, { user: "usr_b" });
    const response = await register(TOKEN_A, {
      hopId: "hop_jam",
      since: T0,
      environment: "sandbox",
    });
    expect(response.status).toBe(409);
    const row = await db.select().from(liveActivities).get();
    expect(row?.userId).toBe("usr_b");
  });

  it("keeps only the newest few per athlete", async () => {
    for (let i = 0; i < LIVE_ACTIVITIES_PER_USER + 2; i++) {
      const token = i.toString(16).padStart(2, "0").repeat(40);
      await register(token, { hopId: "hop_jam", since: T0, environment: "sandbox" });
      // Distinct creation times, oldest first.
      await db
        .update(liveActivities)
        .set({ createdAt: T0 + i })
        .where(eq(liveActivities.token, token));
    }
    const kept = await db.select({ token: liveActivities.token }).from(liveActivities);
    expect(kept).toHaveLength(LIVE_ACTIVITIES_PER_USER);
    expect(kept.map((r) => r.token)).not.toContain("00".repeat(40));
  });

  it("forgets it when Event mode ends, but only the athlete's own", async () => {
    await watching(TOKEN_A);
    await watching(TOKEN_B, { user: "usr_b" });
    expect((await call(`/me/live-activities/${TOKEN_A}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/me/live-activities/${TOKEN_B}`, { method: "DELETE" })).status).toBe(200);
    const left = await db.select({ token: liveActivities.token }).from(liveActivities);
    expect(left.map((r) => r.token)).toEqual([TOKEN_B]);
  });

  it("needs a session", async () => {
    session = "hs_nope";
    expect(
      (await register(TOKEN_A, { hopId: "hop_jam", since: T0, environment: "sandbox" })).status,
    ).toBe(401);
  });
});

describe("pushing arrivals", () => {
  it("sends each Live Activity its own count, signed for Apple", async () => {
    await watching(TOKEN_A, { since: T0 });
    await watching(TOKEN_B, { since: T0 + 2 * MIN });
    await clip("hop_jam", T0 - MIN, "Before");
    await clip("hop_jam", T0 + MIN, "@leo");
    await clip("hop_jam", T0 + 3 * MIN, "@mia");

    await pushArrivals(env, "hop_jam", T0 + 4 * MIN);

    expect(pushes).toHaveLength(2);
    const a = pushes.find((p) => p.url.endsWith(TOKEN_A));
    const b = pushes.find((p) => p.url.endsWith(TOKEN_B));
    expect(a?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${TOKEN_A}`);
    expect(a?.body.aps["content-state"]).toEqual({ clips: 2, latest: "@mia" });
    expect(b?.body.aps["content-state"]).toEqual({ clips: 1, latest: "@mia" });
    expect(a?.body.aps).toMatchObject({
      event: "update",
      timestamp: Math.floor((T0 + 4 * MIN) / 1000),
    });
    expect(a?.headers).toMatchObject({
      "apns-push-type": "liveactivity",
      "apns-topic": "com.onmyhop.app.push-type.liveactivity",
      "apns-priority": "10",
    });

    // The provider token is an ES256 JWT that verifies with the key's public half.
    const jwt = (a?.headers.authorization ?? "").replace(/^bearer /, "");
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64url(part)));
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decode(claims)).toEqual({ iss: "TEAM123456", iat: Math.floor((T0 + 4 * MIN) / 1000) });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("lights the screen up for the first clip, then at most every few minutes", async () => {
    await watching(TOKEN_A);
    await clip("hop_jam", T0 + MIN, "@mia");
    await pushArrivals(env, "hop_jam", T0 + MIN);
    expect(pushes[0]?.body.aps.alert).toEqual({ title: "New clip", body: "@mia sent a clip" });

    await clip("hop_jam", T0 + 2 * MIN, null);
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    expect(pushes[1]?.body.aps.alert).toBeUndefined();
    expect(pushes[1]?.body.aps["content-state"]).toEqual({ clips: 2, latest: null });

    await clip("hop_jam", T0 + MIN + ALERT_EVERY_MS, null);
    await pushArrivals(env, "hop_jam", T0 + MIN + ALERT_EVERY_MS);
    expect(pushes[2]?.body.aps.alert).toEqual({ title: "New clip", body: "A clip just landed" });
  });

  it("alerts once when a burst of uploads completes at the same time", async () => {
    await watching(TOKEN_A);
    await clip("hop_jam", T0 + MIN, "@mia");
    await clip("hop_jam", T0 + MIN, "@leo");
    await clip("hop_jam", T0 + MIN, "@kai");
    await Promise.all([
      pushArrivals(env, "hop_jam", T0 + MIN),
      pushArrivals(env, "hop_jam", T0 + MIN + 1),
      pushArrivals(env, "hop_jam", T0 + MIN + 2),
    ]);
    expect(pushes).toHaveLength(3);
    expect(pushes.filter((p) => p.body.aps.alert)).toHaveLength(1);
  });

  it("hands the alert back when the push that claimed it fails", async () => {
    await watching(TOKEN_A);
    await clip("hop_jam", T0 + MIN);
    apnsReply = () => new Response(JSON.stringify({ reason: "TooManyRequests" }), { status: 429 });
    await pushArrivals(env, "hop_jam", T0 + MIN);
    expect(pushes[0]?.body.aps.alert).toBeDefined();

    apnsReply = () => new Response(null, { status: 200 });
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    expect(pushes[1]?.body.aps.alert).toBeDefined();
    const row = await db.select().from(liveActivities).get();
    expect(row?.alertedAt).toBe(T0 + 2 * MIN);
  });

  it("records only updates that reached the phone, for the new-clips push", async () => {
    await watching(TOKEN_A);
    await clip("hop_jam", T0 + MIN);
    apnsReply = () => new Response(JSON.stringify({ reason: "TooManyRequests" }), { status: 429 });
    await pushArrivals(env, "hop_jam", T0 + MIN);
    expect((await db.select().from(liveActivities).get())?.pushedAt).toBeNull();

    apnsReply = () => new Response(null, { status: 200 });
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    expect((await db.select().from(liveActivities).get())?.pushedAt).toBe(T0 + 2 * MIN);
    // An older update finishing late doesn't move it back.
    await pushArrivals(env, "hop_jam", T0 + MIN + 30 * 1000);
    expect((await db.select().from(liveActivities).get())?.pushedAt).toBe(T0 + 2 * MIN);
  });

  it("forgets tokens Apple no longer accepts, and keeps the rest after a hiccup", async () => {
    await watching(TOKEN_A);
    await watching(TOKEN_B);
    await clip("hop_jam", T0 + MIN);
    apnsReply = (token) =>
      token === TOKEN_A
        ? new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 })
        : new Response(JSON.stringify({ reason: "TooManyRequests" }), { status: 429 });
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    const left = await db.select().from(liveActivities);
    expect(left.map((r) => r.token)).toEqual([TOKEN_B]);
    // A failed push didn't count as the alert.
    expect(left[0]?.alertedAt).toBeNull();
  });

  it("skips expired registrations, and does nothing without a key", async () => {
    await watching(TOKEN_A, { expiresAt: T0 + MIN });
    await clip("hop_jam", T0 + MIN);
    await pushArrivals(env, "hop_jam", T0 + 2 * MIN);
    expect(pushes).toHaveLength(0);

    await watching(TOKEN_B);
    await pushArrivals({ ...env, APNS_KEY: undefined }, "hop_jam", T0 + 2 * MIN);
    expect(pushes).toHaveLength(0);
  });

  it("reuses the provider token rather than signing one per push", async () => {
    await watching(TOKEN_A);
    await clip("hop_jam", T0 + MIN);
    await pushArrivals(env, "hop_jam", T0 + MIN);
    await pushArrivals(env, "hop_jam", T0 + 10 * MIN);
    expect(pushes[0]?.headers.authorization).toBe(pushes[1]?.headers.authorization);
    await pushArrivals(env, "hop_jam", T0 + 60 * MIN);
    expect(pushes[2]?.headers.authorization).not.toBe(pushes[0]?.headers.authorization);
  });
});

it("cleanup removes expired registrations", async () => {
  await watching(TOKEN_A, { expiresAt: Date.now() - MIN });
  await watching(TOKEN_B, { expiresAt: Date.now() + MIN });
  await cleanup(env);
  const left = await db.select({ token: liveActivities.token }).from(liveActivities);
  expect(left.map((r) => r.token)).toEqual([TOKEN_B]);
});
