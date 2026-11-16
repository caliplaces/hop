import type { PlanStatus } from "@hop/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "./cron";
import { getDb } from "./db";
import { devices, expiryNotices, files, hops, sessions, subscriptions, users } from "./db/schema";
import type { Env } from "./env";
import {
  expireClips,
  forgetOldNotices,
  goesAt,
  LAPSE_MARGIN_MS,
  NOTICE_MS,
  RETENTION_MS,
  remindOfExpiry,
  statedDay,
} from "./expiry";
import worker from "./index";
import { deleteAccount } from "./lib/accounts";
import { forgetProviderToken } from "./lib/apns";
import { randomToken, sha256Hex } from "./lib/crypto";
import { createTestD1, type SqliteValue } from "./test/d1";
import { createTestR2 } from "./test/r2";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PHONE = "a".repeat(64);

/** Monday 16 November 2026, 03:00 UTC: a notice now names Monday 23 November. */
const NOW = Date.UTC(2026, 10, 16, 3, 0);
/** That notice's clips go once Monday 23 November has ended everywhere: Tuesday, 12:00 UTC. */
const GOES = Date.UTC(2026, 10, 24, 12, 0);

let env: Env;
let db: ReturnType<typeof getDb>;
let r2: ReturnType<typeof createTestR2>;
/** Every email Resend was asked to send, whether it went or not. */
let tried: { subject: string; key: string | null }[];
let emails: { to: string[]; subject: string; text: string; key: string | null }[];
let pushes: {
  token: string;
  topic: string | null;
  pushType: string | null;
  collapseId: string | null;
  body: Record<string, unknown>;
}[];
let resendUp: boolean;
let apnsReply: (token: string) => Response;
let limited: boolean;
let queries: { query: string; params: SqliteValue[] }[];
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
const notices = () => db.select().from(expiryNotices);

async function plus(userId: string, until: number) {
  await db.insert(subscriptions).values({
    originalTransactionId: `tx_${userId}_${until}`,
    userId,
    productId: "hop_plus",
    environment: "Production",
    expiresAt: until,
    purchasedAt: until - 30 * DAY,
    signedAt: until - 30 * DAY,
    createdAt: until - 30 * DAY,
    updatedAt: until - 30 * DAY,
  });
}

async function phone(
  userId: string,
  device: string,
  environment: "sandbox" | "production" = "sandbox",
) {
  await db
    .insert(devices)
    .values({ token: device, userId, environment, createdAt: NOW, updatedAt: NOW });
}

/** Runs the five-minute job at each of these times. */
async function runAt(...times: number[]) {
  for (const time of times) await remindOfExpiry(env, time);
}

/** Runs it every five minutes, from `from` to `to`. */
async function everyFiveMinutes(from: number, to: number) {
  for (let at = from; at <= to; at += 5 * MIN) await remindOfExpiry(env, at);
}

beforeEach(async () => {
  forgetProviderToken();
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  queries = [];
  const DB = createTestD1({ onQuery: (query, params) => queries.push({ query, params }) });
  r2 = createTestR2();
  limited = false;
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
    PROFILE_LIMITER: { limit: async () => ({ success: !limited }) },
  } as unknown as Env;
  db = getDb(DB);
  tried = [];
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
          collapseId: headers.get("apns-collapse-id"),
          body: JSON.parse(String(init?.body)),
        });
        return apnsReply(device);
      }
      expect(url).toBe("https://api.resend.com/emails");
      const body = JSON.parse(String(init?.body));
      tried.push({ subject: body.subject, key: headers.get("idempotency-key") });
      if (!resendUp) return Response.json({ name: "internal_server_error" }, { status: 500 });
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
    // No address: only a phone can reach her, if she has one.
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
  await phone("alex", PHONE);
  token = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId: "alex",
    kind: "app",
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * DAY,
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

describe("the day a notice names", () => {
  it("is a week on, and its clips stay until it has ended everywhere", () => {
    expect(statedDay(NOW)).toBe(Date.UTC(2026, 10, 23));
    expect(goesAt(statedDay(NOW))).toBe(GOES);
  });

  it("leaves more than a week, whenever the notice is claimed", () => {
    for (let batch = NOW; batch < NOW + 2 * DAY; batch += 7 * MIN) {
      const day = statedDay(batch);
      const goes = goesAt(day);
      // Given up to six hours after its claim, it's still more than a week.
      expect(goes - (batch + 6 * HOUR)).toBeGreaterThan(NOTICE_MS);
      // The named day has ended in UTC−12 (and so everywhere) by then.
      expect(goes).toBeGreaterThanOrEqual(day + DAY + 12 * HOUR);
      // A calendar day: midnight UTC.
      expect(day % DAY).toBe(0);
    }
  });
});

describe("the notice, a week ahead", () => {
  it("tells a free athlete by email and on their phone which clips go, and which day", async () => {
    const due = await clip("alex", 25 * DAY);
    const young = await clip("alex", 10 * DAY);
    await runAt(NOW);

    const title = "1 clip leaves your inbox on Monday 23 November";
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: ["alex@example.com"],
      subject: title,
      key: `clips-expiring/notice/alex/${NOW}`,
    });
    expect(emails[0]?.text).toContain("get Hop+ in the Hop app");
    expect(emails[0]?.text).toContain("https://onmyhop.com/app");
    expect(pushes).toEqual([
      {
        token: PHONE,
        topic: "com.onmyhop.app",
        pushType: "alert",
        collapseId: `expiring-${NOW}`,
        body: {
          aps: { alert: { title, body: expect.any(String) }, sound: "default" },
          hop: "expiring",
        },
      },
    ]);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: NOW, expiryGoesAt: GOES });
    expect(await row(young)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
  });

  it("isn't sent with Hop+", async () => {
    await plus("bea", NOW + 30 * DAY);
    const old = await clip("bea", 100 * DAY);
    await runAt(NOW);
    expect(emails).toEqual([]);
    expect((await row(old))?.expiryNoticeBatch).toBeNull();
  });

  it("waits a month after Hop+ ends, in case it renews late", async () => {
    await plus("bea", NOW - 10 * DAY);
    await clip("bea", 200 * DAY);
    await runAt(NOW, NOW + LAPSE_MARGIN_MS - 10 * DAY - MIN);
    expect(emails).toEqual([]);
    await runAt(NOW + LAPSE_MARGIN_MS - 10 * DAY + MIN);
    expect(emails.map((email) => email.to)).toEqual([["bea@example.com"]]);
  });

  it("comes at most once a day, covering every clip due one", async () => {
    await clip("alex", 25 * DAY);
    await clip("alex", 24 * DAY);
    await runAt(NOW);
    expect(emails[0]?.subject).toMatch(/^2 clips leave/);

    // Another clip becomes due a few hours later: it waits for tomorrow.
    const later = await clip("alex", 23 * DAY - 2 * HOUR);
    await runAt(NOW + 3 * HOUR);
    expect(emails).toHaveLength(1);
    await runAt(NOW + DAY + MIN);
    expect(emails).toHaveLength(2);
    expect(emails[1]?.subject).toBe("1 clip leaves your inbox on Tuesday 24 November");
    expect((await row(later))?.expiryGoesAt).toBe(GOES + DAY);
  });

  it("counts its day from when it got through, not when it was claimed", async () => {
    await clip("alex", 25 * DAY);
    resendUp = false;
    await runAt(NOW, NOW + 5 * MIN, NOW + 15 * MIN, NOW + 35 * MIN, NOW + 75 * MIN);
    resendUp = true;
    const given = NOW + 135 * MIN;
    await runAt(given);
    expect(emails).toHaveLength(1);

    // A day after the claim, but not after it reached them: tomorrow's waits.
    await clip("alex", 23 * DAY - 2 * HOUR);
    await runAt(NOW + DAY + MIN);
    expect(emails).toHaveLength(1);
    await runAt(given + DAY + MIN);
    expect(emails).toHaveLength(2);
  });

  it("isn't claimed for someone Hop can't reach: their clips stay", async () => {
    const old = await clip("cleo", 25 * DAY);
    await runAt(NOW);
    expect(await notices()).toEqual([]);
    expect(await row(old)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
    expect(await expireClips(db, NOW + 100 * DAY)).toBe(0);
  });

  it("isn't emailed to an address nobody proved is theirs", async () => {
    await db
      .update(users)
      .set({ email: "cleo@example.com", emailVerified: false })
      .where(eq(users.id, "cleo"));
    await clip("cleo", 25 * DAY);
    await runAt(NOW);
    expect(tried).toEqual([]);
    expect(await notices()).toEqual([]);
  });

  it("counts once a phone took it, for someone with no address", async () => {
    const old = await clip("cleo", 25 * DAY);
    await phone("cleo", "c".repeat(64));
    apnsReply = () => Response.json({ reason: "InternalServerError" }, { status: 500 });
    await runAt(NOW);
    expect(pushes).toHaveLength(1);
    expect((await row(old))?.expiryGoesAt).toBeNull();

    // Pushed again, as nothing got through.
    apnsReply = () => new Response(null, { status: 200 });
    await runAt(NOW + 5 * MIN);
    expect(pushes).toHaveLength(2);
    expect((await row(old))?.expiryGoesAt).toBe(GOES);
  });

  it("with an address, counts once the email went; the phone hears just once", async () => {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    await runAt(NOW, NOW + 5 * MIN, NOW + 15 * MIN, NOW + 35 * MIN, NOW + 75 * MIN);
    expect(tried).toHaveLength(5);
    // The phone took it the first time; it isn't buzzed every few minutes.
    expect(pushes).toHaveLength(1);
    // A push can be silenced in Settings and still be taken: not enough.
    expect((await row(due))?.expiryGoesAt).toBeNull();
    expect(await expireClips(db, NOW + 100 * DAY)).toBe(0);

    resendUp = true;
    await runAt(NOW + 2 * HOUR + 35 * MIN);
    expect(emails.map((email) => email.key)).toEqual([`clips-expiring/notice/alex/${NOW}`]);
    expect(pushes).toHaveLength(1);
    expect((await row(due))?.expiryGoesAt).toBe(GOES);
  });

  it("is tried again less and less often", async () => {
    await clip("alex", 25 * DAY);
    resendUp = false;
    // Every five minutes for an hour: tries at 0, 5, 15 and 35 minutes.
    await everyFiveMinutes(NOW, NOW + HOUR);
    expect(tried).toHaveLength(4);
  });

  it("says the same on every try, under the same key", async () => {
    const first = await clip("alex", 25 * DAY);
    await clip("alex", 25 * DAY);
    resendUp = false;
    await runAt(NOW);
    // One is deleted before the retry: the email (and its key) stay as they were.
    await db.update(files).set({ status: "deleting" }).where(eq(files.id, first));
    resendUp = true;
    await runAt(NOW + 5 * MIN);
    const sent = {
      subject: "2 clips leave your inbox on Monday 23 November",
      key: `clips-expiring/notice/alex/${NOW}`,
    };
    expect(tried).toEqual([sent, sent]);
  });

  it("is let go after six hours without getting through, and claimed afresh the next day", async () => {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    // Tries back off to hourly: the one after six hours lets it go.
    await everyFiveMinutes(NOW, NOW + 6 * HOUR + 20 * MIN);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
    expect((await notices())[0]?.abandonedAt).not.toBeNull();

    resendUp = true;
    await runAt(NOW + 12 * HOUR);
    expect(emails).toEqual([]);
    const next = NOW + DAY + MIN;
    await runAt(next);
    expect(emails.map((email) => email.key)).toEqual([`clips-expiring/notice/alex/${next}`]);
    expect(emails[0]?.subject).toBe("1 clip leaves your inbox on Tuesday 24 November");
    expect((await row(due))?.expiryGoesAt).toBe(GOES + DAY);
  });

  it("is let go when its clips are gone before it's sent", async () => {
    const only = await clip("alex", 25 * DAY);
    resendUp = false;
    await runAt(NOW);
    await db.update(files).set({ status: "deleting" }).where(eq(files.id, only));
    resendUp = true;
    await runAt(NOW + 5 * MIN);
    expect(emails).toEqual([]);
    expect((await notices())[0]?.abandonedAt).toBe(NOW + 5 * MIN);
  });

  it("is pushed only to phones this server can reach", async () => {
    await phone("alex", "d".repeat(64), "production");
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    expect(pushes.map((push) => push.token)).toEqual([PHONE]);
  });

  it("goes out with the five-minute email jobs", async () => {
    await clip("alex", 25 * DAY);
    await worker.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() } as ScheduledController,
      env,
      { waitUntil: () => {} } as unknown as ExecutionContext,
    );
    await vi.waitFor(() => expect(emails).toHaveLength(1));
  });

  it("forgets a phone Apple says is gone, and only then", async () => {
    apnsReply = () => Response.json({ reason: "DeviceTokenNotForTopic" }, { status: 400 });
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    // Likelier this server's setup than the phone: kept.
    expect(await db.select().from(devices)).toHaveLength(1);

    apnsReply = () => Response.json({ reason: "Unregistered" }, { status: 410 });
    await clip("alex", 24 * DAY);
    await runAt(NOW + DAY + MIN);
    expect(await db.select().from(devices)).toEqual([]);
    // The emails went all the same.
    expect(emails).toHaveLength(2);
  });
});

describe("the reminder, the day before", () => {
  it("comes once, naming the day again", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW, GOES - 2 * DAY - MIN);
    expect(emails).toHaveLength(1);

    await runAt(GOES - 2 * DAY + MIN);
    const title = "Last call: 1 clip leaves your inbox on Monday 23 November";
    expect(emails[1]).toMatchObject({
      subject: title,
      key: `clips-expiring/reminder/alex/${NOW}`,
    });
    // On the phone, it replaces the notice.
    expect(pushes.at(-1)).toMatchObject({
      collapseId: `expiring-${NOW}`,
      body: { aps: { alert: { title } } },
    });

    await runAt(GOES - 2 * DAY + 2 * HOUR, GOES - DAY);
    expect(emails).toHaveLength(2);
  });

  it("counts the clips still there", async () => {
    const first = await clip("alex", 25 * DAY);
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    await db.update(files).set({ status: "deleting" }).where(eq(files.id, first));
    await runAt(GOES - 2 * DAY + MIN);
    expect(emails[1]?.subject).toBe("Last call: 1 clip leaves your inbox on Monday 23 November");
  });

  it("isn't sent when it's too late to help", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW, GOES - 30 * MIN, GOES - 10 * MIN);
    expect(emails).toHaveLength(1);
    expect((await notices())[0]?.remindedAt).toBe(GOES - 30 * MIN);
  });

  it("comes at most once a day", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    await clip("alex", 23 * DAY - 2 * HOUR);
    await runAt(NOW + DAY + MIN);
    expect(emails).toHaveLength(2);

    // Late (say the job was down): the first reminder goes, then the second
    // waits a day after it, still before its clips go.
    const late = GOES - 30 * HOUR;
    await runAt(late, GOES - DAY + MIN, late + 22 * HOUR);
    expect(emails.slice(2).map((email) => email.subject)).toEqual([
      "Last call: 1 clip leaves your inbox on Monday 23 November",
    ]);
    await runAt(late + 23 * HOUR + MIN);
    expect(emails.slice(2).map((email) => email.subject)).toEqual([
      "Last call: 1 clip leaves your inbox on Monday 23 November",
      "Last call: 1 clip leaves your inbox on Tuesday 24 November",
    ]);
  });
});

describe("expiring", () => {
  it("removes a clip once its day has ended everywhere, from R2 too", async () => {
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    expect(await expireClips(db, GOES - MIN)).toBe(0);
    expect(await expireClips(db, GOES)).toBe(1);
    expect((await row(due))?.status).toBe("deleting");

    await cleanup(env);
    expect(await row(due)).toBeUndefined();
    expect(r2.objects.has(`hops/hop_alex/${due}/original`)).toBe(false);
  });

  it("never takes a clip without a notice that reached them, however old", async () => {
    // Bea's Hop+ ended long ago: her old clips are well past 30 days.
    await plus("bea", NOW - LAPSE_MARGIN_MS - DAY);
    const old = await clip("bea", 200 * DAY);
    expect(await expireClips(db, NOW)).toBe(0);
    await runAt(NOW);
    expect(emails[0]?.to).toEqual(["bea@example.com"]);
    expect(await expireClips(db, NOW + NOTICE_MS)).toBe(0);
    expect(await expireClips(db, GOES)).toBe(1);
    expect((await row(old))?.status).toBe("deleting");
  });

  it("keeps everything once they get Hop+, and starts over a month after it ends", async () => {
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    // Two days later they subscribe, for a month.
    const ends = NOW + 32 * DAY;
    await plus("alex", ends);
    await runAt(NOW + 2 * DAY);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
    expect(await notices()).toEqual([]);
    expect(await expireClips(db, NOW + 10 * DAY)).toBe(0);

    // It ends; a month later, a fresh notice and another week.
    await runAt(ends + DAY, ends + LAPSE_MARGIN_MS - MIN);
    expect(emails).toHaveLength(1);
    const again = ends + LAPSE_MARGIN_MS + MIN;
    await runAt(again);
    expect(emails).toHaveLength(2);
    const goes = goesAt(statedDay(again));
    expect((await row(due))?.expiryGoesAt).toBe(goes);
    expect(await expireClips(db, goes - MIN)).toBe(0);
    expect(await expireClips(db, goes)).toBe(1);
  });

  it("keeps a clip whose athlete got Hop+ since its notice, before anything else ran", async () => {
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    await plus("alex", NOW + 60 * DAY);
    expect(await expireClips(db, GOES)).toBe(0);
    expect((await row(due))?.status).toBe("complete");
  });

  it("happens in the hourly cleanup, removed from R2 in the same run", async () => {
    const due = await clip("alex", 31 * DAY);
    await db
      .update(files)
      .set({ expiryNoticeBatch: NOW - 9 * DAY, expiryGoesAt: Date.now() - HOUR })
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
    await runAt(NOW);
    await expireClips(db, GOES);
    expect((await row(due))?.status).toBe("held");
  });

  it("leaves younger clips and other athletes alone", async () => {
    await clip("alex", 25 * DAY);
    const young = await clip("alex", 2 * DAY);
    const beas = await clip("bea", 3 * DAY);
    await runAt(NOW);
    await expireClips(db, GOES);
    expect((await row(young))?.status).toBe("complete");
    expect((await row(beas))?.status).toBe("complete");
  });

  it("matches the plan's 30 days", () => {
    expect(RETENTION_MS).toBe(30 * DAY);
  });
});

describe("the plan", () => {
  it("says which clips are leaving and the day they were told, until Hop+", async () => {
    await clip("alex", 25 * DAY);
    await clip("alex", 24 * DAY);
    await runAt(NOW);
    const status = (await (await call("/me/plan")).json()) as PlanStatus;
    expect(status.expiring).toEqual({ clips: 2, on: "2026-11-23", at: GOES });

    await plus("alex", Date.now() + 30 * DAY);
    const withPlus = (await (await call("/me/plan")).json()) as PlanStatus;
    expect(withPlus.expiring).toBeNull();
  });

  it("has nothing leaving until a notice got through", async () => {
    await clip("alex", 25 * DAY);
    expect(((await (await call("/me/plan")).json()) as PlanStatus).expiring).toBeNull();
    resendUp = false;
    await runAt(NOW);
    expect(((await (await call("/me/plan")).json()) as PlanStatus).expiring).toBeNull();
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
    // Signed in as Bea on that phone (Alex's sign-out didn't reach the API): it's hers now.
    const beaToken = `hs_${randomToken()}`;
    await db.insert(sessions).values({
      id: await sha256Hex(beaToken),
      userId: "bea",
      kind: "app",
      createdAt: Date.now(),
      expiresAt: Date.now() + DAY,
    });
    await put(other.toUpperCase(), "sandbox", { authorization: `Bearer ${beaToken}` });
    expect((await db.select().from(devices).where(eq(devices.token, other)).get())?.userId).toBe(
      "bea",
    );
  });

  it("keep an athlete's newest five", async () => {
    await db.delete(devices);
    for (let i = 1; i <= 5; i++) {
      await db.insert(devices).values({
        token: String(i).repeat(64),
        userId: "alex",
        environment: "sandbox",
        createdAt: NOW + i,
        updatedAt: NOW + i,
      });
    }
    expect((await put(other)).status).toBe(200);
    const kept = await db
      .select({ token: devices.token })
      .from(devices)
      .where(eq(devices.userId, "alex"));
    expect(kept.map((device) => device.token).sort()).toEqual(
      [other, "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(64)].sort(),
    );
  });

  it("can't be registered by the thousand", async () => {
    limited = true;
    expect((await put(other)).status).toBe(429);
    expect(await db.select().from(devices).where(eq(devices.token, other))).toEqual([]);
  });

  it("refuse tokens this server can't push to, or that aren't tokens", async () => {
    expect((await put(other, "production")).status).toBe(409);
    expect((await put("not-a-token")).status).toBe(400);
    expect((await put(other, "elsewhere")).status).toBe(400);
  });

  it("unregister on sign-out, only their own", async () => {
    const beas = "c".repeat(64);
    await phone("bea", beas);
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

  it("are forgotten when the app hasn't refreshed them in 90 days", async () => {
    const beas = "c".repeat(64);
    await phone("bea", beas);
    await db
      .update(devices)
      .set({ updatedAt: Date.now() - 91 * DAY })
      .where(eq(devices.token, PHONE));
    await db
      .update(devices)
      .set({ updatedAt: Date.now() - 89 * DAY })
      .where(eq(devices.token, beas));
    await cleanup(env);
    expect((await db.select().from(devices)).map((device) => device.userId)).toEqual(["bea"]);
  });
});

describe("housekeeping", () => {
  it("forgets notices once their clips are gone, and let-go ones after two days", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    resendUp = false;
    await clip("bea", 25 * DAY);
    // Tries back off to hourly: the one after six hours lets it go.
    await everyFiveMinutes(NOW, NOW + 6 * HOUR + 20 * MIN);
    expect((await notices()).map((notice) => notice.userId).sort()).toEqual(["alex", "bea"]);

    // Alex's clip still waits to go: kept. Bea's was let go: kept for that day's limit.
    await forgetOldNotices(db, NOW + DAY + HOUR);
    expect(await notices()).toHaveLength(2);
    await expireClips(db, GOES);
    await cleanup(env);
    await forgetOldNotices(db, NOW + 2 * DAY + HOUR);
    expect(await notices()).toEqual([]);
  });

  it("forgets everything with a deleted account", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    await deleteAccount(db, "alex");
    expect(await db.select().from(devices)).toEqual([]);
    expect(await notices()).toEqual([]);
  });
});

describe("the queries", () => {
  /** SQLite's plan for each statement run, as "SCAN …" / "SEARCH …" lines. */
  async function plans() {
    const seen = queries.filter(({ query }) => !query.startsWith("EXPLAIN"));
    const out: string[] = [];
    for (const { query, params } of seen) {
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(...params)
        .all<{ detail: string }>();
      for (const step of results) out.push(`${step.detail}   ← ${query.slice(0, 80)}`);
    }
    return out;
  }

  it("never read every clip", async () => {
    // Plenty of clips, as with a library or two, so a bad plan shows.
    for (let i = 0; i < 40; i++) await clip(i % 2 ? "alex" : "bea", i * DAY);
    await plus("bea", NOW + 30 * DAY);
    queries = [];
    await runAt(NOW);
    resendUp = false;
    await runAt(NOW + 5 * MIN, GOES - 2 * DAY + MIN);
    await expireClips(db, GOES);
    await call("/me/plan");
    const steps = await plans();
    expect(steps.length).toBeGreaterThan(0);
    // A scan of files is fine only through one of the small partial indexes.
    const wholeFiles = steps.filter(
      (step) =>
        /^SCAN files\b/.test(step) &&
        !/USING (COVERING )?INDEX files_(goes|notice|unnoticed|unannounced)_idx/.test(step),
    );
    expect(wholeFiles).toEqual([]);
  });
});
