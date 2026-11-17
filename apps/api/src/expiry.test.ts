import type { PlanStatus } from "@hop/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "./cron";
import { getDb } from "./db";
import { devices, expiryNotices, files, hops, sessions, subscriptions, users } from "./db/schema";
import { suppress } from "./email/suppressions";
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
import { emailEvent, svixHeaders, WEBHOOK_SECRET } from "./test/svix";

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
/** Addresses Resend fails for, even while up. */
let resendRefuses: Set<string>;
let apnsReply: (token: string) => Response | Promise<Response>;
let limited: boolean;
let queries: { query: string; params: SqliteValue[] }[];
let token: string;
/** Runs while Resend is being asked, before it answers: to start an overlapping run. */
let duringResend: (() => Promise<void>) | null;
/** Holds the first D1 batch matching `match` until `release` settles. */
let gate: { match: RegExp; reached: () => void; release: Promise<void> } | null;

/** The test D1, with batches that `gate` can hold up. */
function gated(d1: D1Database): D1Database {
  type Statement = D1PreparedStatement & { query: string; inner: D1PreparedStatement };
  const wrap = (inner: D1PreparedStatement, query: string): Statement =>
    ({
      query,
      inner,
      bind: (...params: unknown[]) => wrap(inner.bind(...params), query),
      all: () => inner.all(),
      raw: (...args: Parameters<D1PreparedStatement["raw"]>) => inner.raw(...args),
      run: () => inner.run(),
      first: (column?: string) => inner.first(column as string),
    }) as unknown as Statement;
  return {
    prepare: (query: string) => wrap(d1.prepare(query), query),
    batch: async (statements: Statement[]) => {
      const held = gate;
      if (held && statements.some((statement) => held.match.test(statement.query))) {
        gate = null;
        held.reached();
        await held.release;
      }
      return d1.batch(statements.map((statement) => statement.inner));
    },
  } as unknown as D1Database;
}

/** A promise, and the function that settles it. */
function signal() {
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

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
  duringResend = null;
  gate = null;
  const DB = gated(createTestD1({ onQuery: (query, params) => queries.push({ query, params }) }));
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
  resendRefuses = new Set();
  apnsReply = () => new Response(null, { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const host = new URL(url).hostname;
      if (host === "api.sandbox.push.apple.com" || host === "api.push.apple.com") {
        const device = url.split("/").at(-1) ?? "";
        pushes.push({
          token: device,
          topic: headers.get("apns-topic"),
          pushType: headers.get("apns-push-type"),
          collapseId: headers.get("apns-collapse-id"),
          body: JSON.parse(String(init?.body)),
        });
        return await apnsReply(device);
      }
      expect(url).toBe("https://api.resend.com/emails");
      const body = JSON.parse(String(init?.body));
      tried.push({ subject: body.subject, key: headers.get("idempotency-key") });
      const during = duringResend;
      duringResend = null;
      await during?.();
      if (!resendUp || resendRefuses.has(body.to[0])) {
        return Response.json({ name: "internal_server_error" }, { status: 500 });
      }
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

  it("is never sent to a deleted account", async () => {
    // As if erasing it hadn't got to its clips or address yet.
    await db
      .update(users)
      .set({ deletedAt: NOW - HOUR })
      .where(eq(users.id, "alex"));
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    expect(tried).toEqual([]);
    expect(await notices()).toEqual([]);
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

  it("isn't given by a phone alone: someone with no address keeps their clips", async () => {
    const old = await clip("cleo", 25 * DAY);
    await phone("cleo", "c".repeat(64));
    await runAt(NOW, NOW + DAY + MIN);
    // A push can be silenced, or sit on a phone that's off, and still be taken.
    expect(pushes).toEqual([]);
    expect(await notices()).toEqual([]);
    expect(await expireClips(db, NOW + 100 * DAY)).toBe(0);
    expect((await row(old))?.status).toBe("complete");
  });

  it("is let go if their address stops being verified before it's sent", async () => {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    await runAt(NOW);
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, "alex"));
    resendUp = true;
    await runAt(NOW + 5 * MIN);
    expect(emails).toEqual([]);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
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
    // Done with, but not counted as a reminder sent.
    expect((await notices())[0]?.remindedAt).toBe(0);
  });

  it("goes one notice at a time, each with its own clips and day", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    await clip("alex", 23 * DAY - 2 * HOUR);
    await clip("alex", 23 * DAY - 2 * HOUR);
    await runAt(NOW + DAY + MIN);
    expect(emails).toHaveLength(2);

    // The first run in a while: the first notice's reminder is too late, the
    // second's isn't. It isn't swallowed, and doesn't borrow the first's day.
    await runAt(GOES - 30 * MIN);
    expect(emails.slice(2).map((email) => email.subject)).toEqual([
      "Last call: 2 clips leave your inbox on Tuesday 24 November",
    ]);
  });

  it("leaves the next notice's reminder for the next day", async () => {
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    await clip("alex", 23 * DAY - 2 * HOUR);
    await runAt(NOW + DAY + MIN);

    // Both are due at once: the soonest goes now, the other a day later.
    await runAt(GOES - 23 * HOUR);
    expect(emails.slice(2).map((email) => email.subject)).toEqual([
      "Last call: 1 clip leaves your inbox on Monday 23 November",
    ]);
    await runAt(GOES + MIN);
    expect(emails.slice(2).map((email) => email.subject)).toEqual([
      "Last call: 1 clip leaves your inbox on Monday 23 November",
      "Last call: 1 clip leaves your inbox on Tuesday 24 November",
    ]);
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

  it("checks the notice again, not just the clip's time", async () => {
    const lettingGo = await clip("alex", 31 * DAY);
    const unknown = await clip("alex", 31 * DAY);
    await db.insert(expiryNotices).values({
      userId: "alex",
      batch: NOW - 9 * DAY,
      clips: 1,
      goesAt: NOW - HOUR,
      attempts: 1,
      nextAttemptAt: NOW - 9 * DAY,
      givenAt: NOW - 9 * DAY,
      abandonedAt: NOW - 9 * DAY,
    });
    await db
      .update(files)
      .set({ expiryNoticeBatch: NOW - 9 * DAY, expiryGoesAt: NOW - HOUR })
      .where(eq(files.id, lettingGo));
    // A time to go, but no notice behind it at all.
    await db
      .update(files)
      .set({ expiryGoesAt: NOW - HOUR })
      .where(eq(files.id, unknown));
    expect(await expireClips(db, NOW)).toBe(0);
  });

  it("waits out the month after Hop+, however its clips were noticed", async () => {
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    // Hop+ for a few minutes, between two runs: nothing cleared the notice.
    await plus("alex", NOW + DAY);
    expect(await expireClips(db, GOES)).toBe(0);
    expect(await expireClips(db, NOW + DAY + LAPSE_MARGIN_MS + MIN)).toBe(1);
    expect((await row(due))?.status).toBe("deleting");
  });

  it("happens in the hourly cleanup, removed from R2 in the same run", async () => {
    const due = await clip("alex", 31 * DAY);
    const goes = Date.now() - HOUR;
    await db.insert(expiryNotices).values({
      userId: "alex",
      batch: NOW - 9 * DAY,
      clips: 1,
      goesAt: goes,
      attempts: 1,
      nextAttemptAt: NOW - 9 * DAY,
      givenAt: NOW - 9 * DAY,
    });
    await db
      .update(files)
      .set({ expiryNoticeBatch: NOW - 9 * DAY, expiryGoesAt: goes })
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

describe("overlapping runs", () => {
  /** A notice whose next try is just inside its six hours, with Resend failing until then. */
  async function nearlyLetGo() {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    await runAt(NOW);
    await db.update(expiryNotices).set({ nextAttemptAt: NOW + 6 * HOUR - MIN });
    resendUp = true;
    return due;
  }

  it("leave a notice to the run trying it", async () => {
    const due = await nearlyLetGo();
    // Run B starts while run A's email is out: it neither sends nor lets go.
    duringResend = () => remindOfExpiry(env, NOW + 6 * HOUR + 4 * MIN);
    await remindOfExpiry(env, NOW + 6 * HOUR - MIN);
    expect(tried).toHaveLength(2);
    expect(pushes).toHaveLength(1);
    expect((await notices())[0]).toMatchObject({
      givenAt: NOW + 6 * HOUR - MIN,
      abandonedAt: null,
    });
    expect((await row(due))?.expiryGoesAt).toBe(GOES);
  });

  it("don't try a notice another run tried since it was listed", async () => {
    await clip("alex", 25 * DAY);
    await clip("bea", 25 * DAY);
    resendUp = false;
    await runAt(NOW);
    await db
      .update(expiryNotices)
      .set({ nextAttemptAt: NOW + 4 * MIN })
      .where(eq(expiryNotices.userId, "alex"));
    resendUp = true;
    resendRefuses = new Set(["bea@example.com"]);
    // Run A lists Alex's notice, then Bea's. While Alex's email is out, run B
    // tries Bea's (and fails); A then leaves Bea's alone until its next try.
    duringResend = () => remindOfExpiry(env, NOW + 5 * MIN + 1000);
    await remindOfExpiry(env, NOW + 5 * MIN);
    const toBea = tried.filter((email) => email.key?.includes("/bea/"));
    expect(toBea).toHaveLength(2);
  });

  it("can't let go of a notice another just gave", async () => {
    const due = await nearlyLetGo();
    // Run A's email is out so long that run B, past the six hours and A's
    // hold, lets the notice go; B's letting go lands after A has given it.
    const reached = signal();
    const release = signal();
    gate = { match: /set "abandoned_at"/, reached: reached.settle, release: release.promise };
    let b: Promise<void> | undefined;
    duringResend = async () => {
      b = remindOfExpiry(env, NOW + 6 * HOUR + 10 * MIN);
      await reached.promise;
    };
    await remindOfExpiry(env, NOW + 6 * HOUR - MIN);
    release.settle();
    await b;

    expect((await notices())[0]).toMatchObject({
      givenAt: NOW + 6 * HOUR - MIN,
      abandonedAt: null,
    });
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: NOW, expiryGoesAt: GOES });
  });

  it("can't give a notice another just let go", async () => {
    const due = await nearlyLetGo();
    // Run B, past A's hold, lets the notice go entirely while A's email is out.
    duringResend = () => remindOfExpiry(env, NOW + 6 * HOUR + 10 * MIN);
    await remindOfExpiry(env, NOW + 6 * HOUR - MIN);

    expect((await notices())[0]).toMatchObject({ givenAt: null });
    // Nothing on the clip says it may go: claimed afresh tomorrow.
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
    expect(await expireClips(db, NOW + 100 * DAY)).toBe(0);

    // And Hop+, then a lapse, never lets it go without a fresh notice.
    await plus("alex", NOW + 2 * DAY);
    await runAt(NOW + DAY);
    expect(await expireClips(db, NOW + 2 * DAY + HOUR)).toBe(0);
  });

  it("claim each clip, and each athlete's day, once", async () => {
    await clip("alex", 25 * DAY);
    resendUp = false;
    // Run A is about to claim when run B claims the same athlete.
    const reached = signal();
    const release = signal();
    gate = {
      match: /insert into "expiry_notices"/,
      reached: reached.settle,
      release: release.promise,
    };
    const a = remindOfExpiry(env, NOW);
    await reached.promise;
    const later = await clip("alex", 23 * DAY - 30 * 1000);
    await remindOfExpiry(env, NOW + 30 * 1000);
    // And one more due once B has claimed, before A goes on.
    const after = await clip("alex", 30 * DAY);
    release.settle();
    await a;

    // One notice: A's would have been a second that day.
    expect((await notices()).map((notice) => notice.batch)).toEqual([NOW + 30 * 1000]);
    expect((await row(later))?.expiryNoticeBatch).toBe(NOW + 30 * 1000);
    // Nothing claimed into a notice that doesn't exist: it waits for tomorrow's.
    expect((await row(after))?.expiryNoticeBatch).toBeNull();
  });

  it("clear a time to go left on a clip when it's claimed again", async () => {
    const due = await clip("alex", 25 * DAY);
    await db
      .update(files)
      .set({ expiryGoesAt: NOW - DAY })
      .where(eq(files.id, due));
    resendUp = false;
    await runAt(NOW);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: NOW, expiryGoesAt: null });
  });
});

describe("an address Hop's email can't reach", () => {
  /** Resend's webhook, as it tells Hop of an email to `to`. */
  async function webhook(type: string, to = "alex@example.com", data: object = {}) {
    env = { ...env, RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET };
    const body = JSON.stringify(emailEvent(type, { to: [to], ...data }));
    const response = await call("/email/resend-webhook", {
      method: "POST",
      body,
      headers: await svixHeaders(body),
    });
    expect(response.status).toBe(200);
  }
  const bounced = (to?: string) => webhook("email.bounced", to, { bounce: { type: "Permanent" } });

  it("is never noticed: the clips stay, however it's written", async () => {
    await db.update(users).set({ email: " Alex@Example.com" }).where(eq(users.id, "alex"));
    await suppress(db, ["alex@example.com"], "bounced");
    const old = await clip("alex", 25 * DAY);
    await runAt(NOW);
    expect(tried).toEqual([]);
    expect(pushes).toEqual([]);
    expect(await notices()).toEqual([]);
    expect(await expireClips(db, NOW + 100 * DAY)).toBe(0);
    expect((await row(old))?.status).toBe("complete");
  });

  it("lets a notice waiting to be sent go, unsent, and doesn't tell the phone of it", async () => {
    const due = await clip("alex", 25 * DAY);
    resendUp = false;
    apnsReply = () => Response.json({ reason: "InternalServerError" }, { status: 500 });
    await runAt(NOW);
    expect(tried).toHaveLength(1);
    const pushed = pushes.length;
    await suppress(db, ["alex@example.com"], "complained");
    resendUp = true;
    apnsReply = () => new Response(null, { status: 200 });
    await runAt(NOW + 5 * MIN);
    expect(tried).toHaveLength(1);
    // The clips stay, so the phone isn't told they're going.
    expect(pushes).toHaveLength(pushed);
    expect((await notices())[0]?.abandonedAt).toBe(NOW + 5 * MIN);
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
  });

  it("lets a notice go when its address is stopped while it's being sent", async () => {
    const due = await clip("alex", 25 * DAY);
    // Between the check and the email: while the phone is being told.
    apnsReply = async () => {
      await suppress(db, ["alex@example.com"], "bounced");
      return new Response(null, { status: 200 });
    };
    await runAt(NOW);
    expect(tried).toEqual([]);
    expect((await notices())[0]).toMatchObject({ givenAt: null, abandonedAt: NOW });
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
  });

  it("takes back a notice whose email bounced for good after it was sent: the clips stay", async () => {
    // However the account writes the address.
    await db.update(users).set({ email: "Alex@Example.com" }).where(eq(users.id, "alex"));
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    expect(emails).toHaveLength(1);
    expect((await row(due))?.expiryGoesAt).toBe(GOES);

    await bounced();
    expect((await notices())[0]?.abandonedAt).toBeTypeOf("number");
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
    expect(((await (await call("/me/plan")).json()) as PlanStatus).expiring).toBeNull();
    expect(await expireClips(db, GOES + DAY)).toBe(0);

    // Nor is another one tried, or reminded of.
    await runAt(NOW + 2 * DAY, GOES - DAY);
    expect(tried).toHaveLength(1);
    expect((await row(due))?.status).toBe("complete");
  });

  it("takes it back too when Resend didn't send it", async () => {
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    await webhook("email.suppressed", "alex@example.com", {
      suppressed: { type: "OnAccountSuppressionList" },
    });
    expect(await row(due)).toMatchObject({ expiryNoticeBatch: null, expiryGoesAt: null });
    expect(await expireClips(db, GOES + DAY)).toBe(0);
  });

  it("keeps a notice that arrived, though they reported it as spam; nothing more is emailed", async () => {
    const due = await clip("alex", 25 * DAY);
    await runAt(NOW);
    await webhook("email.complained");
    expect((await notices())[0]).toMatchObject({ abandonedAt: null, givenAt: NOW });

    // The reminder reaches only the phone.
    const pushed = pushes.length;
    await runAt(GOES - DAY);
    expect(tried).toHaveLength(1);
    expect(pushes.length).toBe(pushed + 1);
    expect(await expireClips(db, GOES)).toBe(1);
    expect((await row(due))?.status).toBe("deleting");
  });

  it("leaves other athletes' notices alone", async () => {
    const alexs = await clip("alex", 25 * DAY);
    const beas = await clip("bea", 25 * DAY);
    await runAt(NOW);
    await bounced("bea@example.com");
    expect((await row(alexs))?.expiryGoesAt).toBe(GOES);
    expect((await row(beas))?.expiryGoesAt).toBeNull();
    expect(await expireClips(db, GOES)).toBe(1);
    expect((await row(alexs))?.status).toBe("deleting");
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

  it("counts only the clips leaving first, with their day", async () => {
    await clip("alex", 25 * DAY);
    await clip("alex", 25 * DAY);
    await runAt(NOW);
    // A second notice the next day: those clips leave a day later.
    await clip("alex", 23 * DAY - 2 * HOUR);
    await runAt(NOW + DAY + MIN);
    const status = (await (await call("/me/plan")).json()) as PlanStatus;
    expect(status.expiring).toEqual({ clips: 2, on: "2026-11-23", at: GOES });
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
  /** Expiry's own statements, each with SQLite's plan for it. */
  async function plans() {
    const seen = new Map<string, string[]>();
    for (const { query, params } of queries) {
      if (!/expiry_/.test(query) || /^(EXPLAIN|ANALYZE)/.test(query) || seen.has(query)) continue;
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(...params)
        .all<{ detail: string }>();
      seen.set(
        query,
        results.map((step) => step.detail),
      );
    }
    return seen;
  }

  /**
   * Every step through files uses one of expiry's small indexes, or a clip's
   * ID: never the status indexes, which hold every clip. Only the claim reads
   * every athlete (once each, cheaply), and nothing else does.
   */
  async function expectSmallReads() {
    for (let i = 0; i < 40; i++) await clip(i % 2 ? "alex" : "bea", i * DAY);
    await plus("bea", NOW + 30 * DAY);
    queries = [];
    await runAt(NOW);
    resendUp = false;
    await runAt(NOW + 5 * MIN, GOES - 2 * DAY + MIN);
    await expireClips(db, GOES);
    await forgetOldNotices(db, NOW + 3 * DAY);
    await call("/me/plan");

    const bad: string[] = [];
    const statements = await plans();
    expect(statements.size).toBeGreaterThan(10);
    for (const [query, steps] of statements) {
      for (const step of steps) {
        const throughFiles = /^(SCAN|SEARCH) files\b/.test(step);
        const small =
          /USING (COVERING )?INDEX (files_(goes|notice|unnoticed)_idx|sqlite_autoindex_files_1)\b/.test(
            step,
          );
        const claim = query.startsWith('select "id" from "users"');
        if ((throughFiles && !small) || (/^SCAN users\b/.test(step) && !claim)) {
          bad.push(`${step}   ← ${query.slice(0, 120)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }

  it("never read every clip", async () => {
    await expectSmallReads();
  });

  it("never read every clip, with statistics like production's", async () => {
    // A million clips, nearly all complete, 10,000 athletes: what would tempt
    // SQLite toward the status indexes, were the queries not written against it.
    const run = (query: string) => env.DB.prepare(query).run();
    await run("ANALYZE");
    await run("DELETE FROM sqlite_stat1");
    const stats: [string, string, string][] = [
      ["files", "files_owner_status_activity_idx", "1000000 100 95 1"],
      ["files", "files_owner_status_created_idx", "1000000 100 95 1"],
      ["files", "files_hop_status_created_idx", "1000000 100 95 1"],
      ["files", "files_hop_status_completed_idx", "1000000 100 95 1"],
      ["files", "files_status_activity_idx", "1000000 250000 1"],
      ["files", "files_pass_status_idx", "1000000 10 9"],
      ["files", "files_unnoticed_idx", "900000 90 1"],
      ["files", "files_notice_idx", "5000 5 5"],
      ["files", "files_goes_idx", "5000 50"],
      ["subscriptions", "subscriptions_user_idx", "2000 1 1"],
      ["devices", "devices_user_idx", "20000 2"],
      ["expiry_notices", "sqlite_autoindex_expiry_notices_1", "3000 1 1"],
    ];
    for (const [table, index, stat] of stats) {
      await env.DB.prepare("INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES (?, ?, ?)")
        .bind(table, index, stat)
        .run();
    }
    await run("ANALYZE sqlite_schema");
    await expectSmallReads();
  });
});
