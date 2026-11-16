import type { PlanStatus } from "@hop/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "./cron";
import { getDb } from "./db";
import { devices, files, hops, sessions, subscriptions, users } from "./db/schema";
import type { Env } from "./env";
import { expireClips, NOTICE_MS, RETENTION_MS, remindOfExpiry } from "./expiry";
import worker from "./index";
import { deleteAccount } from "./lib/accounts";
import { forgetProviderToken } from "./lib/apns";
import { randomToken, sha256Hex } from "./lib/crypto";
import { createTestD1 } from "./test/d1";
import { createTestR2 } from "./test/r2";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PHONE = "a".repeat(64);

let env: Env;
let db: ReturnType<typeof getDb>;
let r2: ReturnType<typeof createTestR2>;
/** Now, for the test: clips are dated from it. */
let NOW: number;
let emails: { to: string[]; subject: string; text: string; key: string | null }[];
let pushes: {
  token: string;
  topic: string | null;
  pushType: string | null;
  body: Record<string, unknown>;
}[];
let resendUp: boolean;
let apnsReply: (token: string) => Response;
let token: string;

async function pem(key: CryptoKey) {
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", key)) as ArrayBuffer);
  const base64 = btoa(String.fromCharCode(...der));
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

let fileNumber = 0;
/** A finished clip, `age` old at NOW. */
async function clip(owner: string, age: number) {
  fileNumber += 1;
  const id = `fil_${fileNumber}`;
  const hopId = `hop_${owner}`;
  const r2Key = `hops/${hopId}/${id}/original`;
  await db.insert(files).values({
    id,
    hopId,
    ownerId: owner,
    r2Key,
    originalName: "IMG.MOV",
    mime: "video/quicktime",
    size: 1000,
    partSize: 1000,
    partCount: 1,
    status: "complete",
    passId: "pass",
    uploadTokenHash: "x",
    createdAt: NOW - age,
    lastActivityAt: NOW - age,
    completedAt: NOW - age,
    notifiedAt: NOW - age,
  });
  await r2.bucket.put(r2Key, new Uint8Array([1]));
  return id;
}

const row = (id: string) => db.select().from(files).where(eq(files.id, id)).get();

async function plus(userId: string, until: number) {
  await db.insert(subscriptions).values({
    originalTransactionId: `tx_${userId}_${until}`,
    userId,
    productId: "hop_plus",
    environment: "Production",
    expiresAt: until,
    purchasedAt: NOW - DAY,
    signedAt: NOW - DAY,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
  });
}

beforeEach(async () => {
  forgetProviderToken();
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const DB = createTestD1();
  r2 = createTestR2();
  env = {
    DB,
    BUCKET: r2.bucket,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    APNS_KEY: await pem(pair.privateKey),
    APNS_KEY_ID: "KEY1234567",
    APNS_ENVIRONMENT: "sandbox",
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_BUNDLE_ID: "com.onmyhop.app",
  } as Env;
  db = getDb(DB);
  NOW = Date.now();
  emails = [];
  pushes = [];
  resendUp = true;
  apnsReply = () => new Response(null, { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.includes("push.apple.com")) {
        const device = url.split("/").at(-1) ?? "";
        pushes.push({
          token: device,
          topic: headers.get("apns-topic"),
          pushType: headers.get("apns-push-type"),
          body: JSON.parse(String(init?.body)),
        });
        return apnsReply(device);
      }
      expect(url).toBe("https://api.resend.com/emails");
      if (!resendUp) return Response.json({ name: "internal_server_error" }, { status: 500 });
      const body = JSON.parse(String(init?.body));
      emails.push({
        to: body.to,
        subject: body.subject,
        text: body.text,
        key: headers.get("idempotency-key"),
      });
      return Response.json({ id: "email_1" });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  await db.insert(users).values([
    {
      id: "alex",
      oidcSub: "sub-a",
      handle: "alex",
      email: "alex@example.com",
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "bea",
      oidcSub: "sub-b",
      handle: "bea",
      email: "bea@example.com",
      emailVerified: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
    { id: "cleo", oidcSub: "sub-c", handle: "cleo", createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(hops).values(
    ["alex", "bea", "cleo"].map((id) => ({
      id: `hop_${id}`,
      ownerId: id,
      slug: "inbox",
      title: "Inbox",
      createdAt: NOW,
    })),
  );
  await db.insert(devices).values({
    token: PHONE,
    userId: "alex",
    environment: "sandbox",
    createdAt: NOW,
    updatedAt: NOW,
  });
  token = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId: "alex",
    kind: "app",
    createdAt: NOW,
    expiresAt: NOW + 30 * DAY,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
  );
}

describe("the notice, a week ahead", () => {
  it("tells a free athlete by email and on their phone which clips go, and when", async () => {
    const due = await clip("alex", 25 * DAY);
    const young = await clip("alex", 10 * DAY);
    await remindOfExpiry(env, NOW);

    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toEqual(["alex@example.com"]);
    const day = new Date(NOW + NOTICE_MS).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    expect(emails[0]?.subject).toBe(`1 clip leaves your inbox on ${day}`);
    expect(emails[0]?.text).toContain("get Hop+ in the Hop app");
    expect(emails[0]?.text).toContain("https://onmyhop.com/app");
    expect(emails[0]?.key).toBe(`clips-expiring/notice/alex/${NOW}`);

    expect(pushes).toEqual([
      {
        token: PHONE,
        topic: "com.onmyhop.app",
        pushType: "alert",
        body: {
          aps: {
            alert: { title: `1 clip leaves your inbox on ${day}`, body: expect.any(String) },
            sound: "default",
          },
          hop: "expiring",
        },
      },
    ]);
    expect((await row(due))?.expiryNoticedAt).toBe(NOW);
    expect((await row(young))?.expiryNoticeBatch).toBeNull();
  });

  it("isn't sent with Hop+", async () => {
    await plus("bea", NOW + 30 * DAY);
    const old = await clip("bea", 100 * DAY);
    await remindOfExpiry(env, NOW);
    expect(emails).toEqual([]);
    expect((await row(old))?.expiryNoticeBatch).toBeNull();
  });

  it("comes at most once a day, covering every clip due one", async () => {
    await clip("alex", 25 * DAY);
    await clip("alex", 24 * DAY);
    await remindOfExpiry(env, NOW);
    expect(emails[0]?.subject).toMatch(/^2 clips leave/);

    // Another clip becomes due a few hours later: it waits for tomorrow.
    const later = await clip("alex", 23 * DAY - 2 * HOUR);
    await remindOfExpiry(env, NOW + 3 * HOUR);
    expect(emails).toHaveLength(1);
    await remindOfExpiry(env, NOW + DAY + MIN);
    expect(emails).toHaveLength(2);
    expect((await row(later))?.expiryNoticedAt).toBe(NOW + DAY + MIN);
  });

  it("counts as given without an email address: the app shows it", async () => {
    const old = await clip("cleo", 25 * DAY);
    await remindOfExpiry(env, NOW);
    expect(emails).toEqual([]);
    expect((await row(old))?.expiryNoticedAt).toBe(NOW);
  });

  it("isn't emailed to an address nobody proved is theirs", async () => {
    await db
      .update(users)
      .set({ email: "cleo@example.com", emailVerified: false })
      .where(eq(users.id, "cleo"));
    await clip("cleo", 25 * DAY);
    await remindOfExpiry(env, NOW);
    expect(emails).toEqual([]);
  });

  it("is pushed only to phones this server can reach", async () => {
    await db.insert(devices).values({
      token: "d".repeat(64),
      userId: "alex",
      environment: "production",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await clip("alex", 25 * DAY);
    await remindOfExpiry(env, NOW);
    expect(pushes.map((push) => push.token)).toEqual([PHONE]);
  });

  it("goes out with the five-minute email jobs", async () => {
    await clip("alex", 25 * DAY);
    await worker.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() } as ScheduledController,
      env,
      {
        waitUntil: () => {},
      } as unknown as ExecutionContext,
    );
    await vi.waitFor(() => expect(emails).toHaveLength(1));
  });

  it("is tried again, as the same email, until it goes", async () => {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    await remindOfExpiry(env, NOW);
    expect((await row(due))?.expiryNoticedAt).toBeNull();
    // Unnoticed, the clip never goes, however old.
    expect(await expireClips(db, NOW + 30 * DAY)).toBe(0);

    resendUp = true;
    await remindOfExpiry(env, NOW + 10 * MIN);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.key).toBe(`clips-expiring/notice/alex/${NOW}`);
    expect((await row(due))?.expiryNoticedAt).toBe(NOW + 10 * MIN);
  });

  it("is claimed afresh after a day of failures, never assumed sent", async () => {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    await remindOfExpiry(env, NOW);
    await remindOfExpiry(env, NOW + DAY);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryNoticedAt: null });

    resendUp = true;
    await remindOfExpiry(env, NOW + DAY + MIN);
    expect(emails[0]?.key).toBe(`clips-expiring/notice/alex/${NOW + DAY + MIN}`);
    expect((await row(due))?.expiryNoticedAt).toBe(NOW + DAY + MIN);
  });

  it("forgets a phone Apple no longer knows", async () => {
    apnsReply = () => Response.json({ reason: "Unregistered" }, { status: 410 });
    await clip("alex", 25 * DAY);
    await remindOfExpiry(env, NOW);
    expect(await db.select().from(devices)).toEqual([]);
    // The email went all the same.
    expect(emails).toHaveLength(1);
  });
});

describe("the reminder, the day before", () => {
  it("comes once, a day before the clips go", async () => {
    const due = await clip("alex", 25 * DAY);
    await remindOfExpiry(env, NOW);
    await remindOfExpiry(env, NOW + 5 * DAY);
    expect(emails).toHaveLength(1);

    await remindOfExpiry(env, NOW + 6 * DAY + MIN);
    expect(emails).toHaveLength(2);
    expect(emails[1]?.subject).toBe("Tomorrow, 1 clip leaves your inbox");
    expect(pushes.at(-1)?.body).toMatchObject({
      aps: { alert: { title: "Tomorrow, 1 clip leaves your inbox" } },
    });
    expect((await row(due))?.expiryRemindedAt).toBe(NOW + 6 * DAY + MIN);

    await remindOfExpiry(env, NOW + 6 * DAY + 2 * HOUR);
    expect(emails).toHaveLength(2);
  });
});

describe("expiring", () => {
  it("removes a clip 30 days old, a week after its notice, from R2 too", async () => {
    const due = await clip("alex", 25 * DAY);
    await remindOfExpiry(env, NOW);
    expect(await expireClips(db, NOW + 6 * DAY)).toBe(0);
    expect(await expireClips(db, NOW + NOTICE_MS + MIN)).toBe(1);
    expect((await row(due))?.status).toBe("deleting");

    await cleanup(env);
    expect(await row(due)).toBeUndefined();
    expect(r2.objects.has(`hops/hop_alex/${due}/original`)).toBe(false);
  });

  it("never takes a clip without a week's notice, however old", async () => {
    // Bea's Hop+ just ended: her old clips are well past 30 days.
    await plus("bea", NOW - MIN);
    const old = await clip("bea", 200 * DAY);
    expect(await expireClips(db, NOW)).toBe(0);
    await remindOfExpiry(env, NOW);
    expect(emails[0]?.to).toEqual(["bea@example.com"]);
    expect(await expireClips(db, NOW + 6 * DAY)).toBe(0);
    expect(await expireClips(db, NOW + NOTICE_MS + MIN)).toBe(1);
    expect((await row(old))?.status).toBe("deleting");
  });

  it("keeps everything once they get Hop+, and starts over if it ends", async () => {
    const due = await clip("alex", 25 * DAY);
    await remindOfExpiry(env, NOW);
    // Two days later they subscribe, for a month.
    await plus("alex", NOW + 32 * DAY);
    await remindOfExpiry(env, NOW + 2 * DAY);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryNoticedAt: null });
    expect(await expireClips(db, NOW + 10 * DAY)).toBe(0);

    // It ends: a fresh notice, and another week.
    await remindOfExpiry(env, NOW + 33 * DAY);
    expect((await row(due))?.expiryNoticedAt).toBe(NOW + 33 * DAY);
    expect(await expireClips(db, NOW + 33 * DAY + 6 * DAY)).toBe(0);
    expect(await expireClips(db, NOW + 33 * DAY + NOTICE_MS + MIN)).toBe(1);
  });

  it("keeps a clip whose athlete got Hop+ since its notice, before anything else ran", async () => {
    const due = await clip("alex", 25 * DAY);
    await remindOfExpiry(env, NOW);
    await plus("alex", NOW + 60 * DAY);
    expect(await expireClips(db, NOW + NOTICE_MS + MIN)).toBe(0);
    expect((await row(due))?.status).toBe("complete");
  });

  it("happens in the hourly cleanup, removed from R2 in the same run", async () => {
    // Noticed eight days ago, and 31 days old.
    const due = await clip("alex", 31 * DAY);
    await db
      .update(files)
      .set({ expiryNoticeBatch: NOW - 8 * DAY, expiryNoticedAt: NOW - 8 * DAY })
      .where(eq(files.id, due));
    await cleanup(env);
    expect(await row(due)).toBeUndefined();
    expect(r2.objects.has(`hops/hop_alex/${due}/original`)).toBe(false);
  });

  it("only hides a clip held for a report", async () => {
    const due = await clip("alex", 25 * DAY);
    await db
      .update(files)
      .set({ heldUntil: NOW + 60 * DAY })
      .where(eq(files.id, due));
    await remindOfExpiry(env, NOW);
    await expireClips(db, NOW + NOTICE_MS + MIN);
    expect((await row(due))?.status).toBe("held");
  });

  it("leaves younger clips and other athletes alone", async () => {
    await clip("alex", 25 * DAY);
    const young = await clip("alex", 2 * DAY);
    const beas = await clip("bea", 3 * DAY);
    await remindOfExpiry(env, NOW);
    await expireClips(db, NOW + NOTICE_MS + MIN);
    expect((await row(young))?.status).toBe("complete");
    expect((await row(beas))?.status).toBe("complete");
  });

  it("matches the plan's 30 days", () => {
    expect(RETENTION_MS).toBe(30 * DAY);
  });
});

describe("the plan", () => {
  it("says which clips are leaving and when, until Hop+", async () => {
    await clip("alex", 25 * DAY);
    await clip("alex", 24 * DAY);
    await remindOfExpiry(env, NOW);
    const status = (await (await call("/me/plan")).json()) as PlanStatus;
    expect(status.expiring).toEqual({ clips: 2, at: NOW + NOTICE_MS });

    await plus("alex", Date.now() + 30 * DAY);
    const withPlus = (await (await call("/me/plan")).json()) as PlanStatus;
    expect(withPlus.expiring).toBeNull();
  });

  it("has nothing leaving before any notice", async () => {
    await clip("alex", 25 * DAY);
    const status = (await (await call("/me/plan")).json()) as PlanStatus;
    expect(status.expiring).toBeNull();
  });
});

describe("phones", () => {
  const other = "b".repeat(64);
  const put = (device: string, environment = "sandbox", headers?: Record<string, string>) =>
    call(`/me/devices/${device}`, {
      method: "PUT",
      body: JSON.stringify({ environment }),
      headers,
    });

  it("register for notifications, one account per phone", async () => {
    expect((await put(other)).status).toBe(200);
    expect(await db.select().from(devices).where(eq(devices.token, other)).get()).toMatchObject({
      userId: "alex",
      environment: "sandbox",
    });
    // Signed in as Bea on that phone: it's hers now.
    const beaToken = `hs_${randomToken()}`;
    await db.insert(sessions).values({
      id: await sha256Hex(beaToken),
      userId: "bea",
      kind: "app",
      createdAt: NOW,
      expiresAt: NOW + DAY,
    });
    await put(other.toUpperCase(), "sandbox", { authorization: `Bearer ${beaToken}` });
    expect((await db.select().from(devices).where(eq(devices.token, other)).get())?.userId).toBe(
      "bea",
    );
  });

  it("refuse tokens this server can't push to, or that aren't tokens", async () => {
    expect((await put(other, "production")).status).toBe(409);
    expect((await put("not-a-token")).status).toBe(400);
    expect((await put(other, "elsewhere")).status).toBe(400);
  });

  it("unregister on sign-out, only their own", async () => {
    const beas = "c".repeat(64);
    await db.insert(devices).values({
      token: beas,
      userId: "bea",
      environment: "sandbox",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await call(`/me/devices/${beas}`, { method: "DELETE" });
    expect(await db.select().from(devices).where(eq(devices.token, beas))).toHaveLength(1);
    await call(`/me/devices/${PHONE}`, { method: "DELETE" });
    expect(await db.select().from(devices).where(eq(devices.token, PHONE))).toEqual([]);
  });

  it("need a signed-in athlete", async () => {
    const response = await worker.fetch(
      new Request(`https://onmyhop.com/api/me/devices/${other}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment: "sandbox" }),
      }),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });

  it("go with a deleted account", async () => {
    await deleteAccount(db, "alex");
    expect(await db.select().from(devices)).toEqual([]);
  });
});
