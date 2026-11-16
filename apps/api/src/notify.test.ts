import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { devices, files, hops, liveActivities, users } from "./db/schema";
import type { Env } from "./env";
import { forgetProviderToken } from "./lib/apns";
import { announceNewClips } from "./notify";
import { createTestD1 } from "./test/d1";

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 14, 12);

type Attempt = { to: string; key: string; subject: string };

let env: Env;
let db: ReturnType<typeof getDb>;
/** Every request made to Resend, and the ones it accepted. */
let attempts: Attempt[];
let sent: Attempt[];
let resend: () => Response;
/** Every push sent to APNs, and how APNs answers. */
let pushes: {
  token: string;
  threadId: string | undefined;
  alert: { title: string; body: string };
  data: Record<string, unknown>;
}[];
let apns: () => Response;
const ok = () => Response.json({ id: "email_1" });
const failure = () => Response.json({ name: "application_error" }, { status: 500 });

beforeEach(() => {
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    RESEND_API_KEY: "re_test",
    SESSION_SECRET: "test-secret",
  } as Env;
  db = getDb(DB);
  attempts = [];
  sent = [];
  resend = ok;
  pushes = [];
  apns = () => new Response(null, { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const headers = init.headers as Record<string, string>;
      const host = new URL(url).hostname;
      if (host === "api.sandbox.push.apple.com" || host === "api.push.apple.com") {
        const { aps, ...data } = body;
        pushes.push({
          token: url.split("/").at(-1) ?? "",
          threadId: aps["thread-id"],
          alert: aps.alert,
          data,
        });
        return apns();
      }
      const attempt = {
        to: body.to[0],
        key: headers["idempotency-key"] ?? "",
        subject: body.subject,
      };
      attempts.push(attempt);
      const response = resend();
      if (response.ok) sent.push(attempt);
      return response;
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function athlete(id: string, overrides: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({
    id,
    oidcSub: `sub-${id}`,
    email: `${id}@example.com`,
    emailVerified: true,
    handle: id,
    color: "mint",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
  await db
    .insert(hops)
    .values({ id: `hop-${id}`, ownerId: id, slug: "inbox", title: "Main", createdAt: T0 });
}

let clipCount = 0;
async function clip(ownerId: string, completedAt: number, contributor = "Lea") {
  const id = `fil-${++clipCount}`;
  await db.insert(files).values({
    id,
    hopId: `hop-${ownerId}`,
    ownerId,
    r2Key: id,
    originalName: `${id}.mp4`,
    mime: "video/mp4",
    size: 1,
    partSize: 1,
    partCount: 1,
    status: "complete",
    passId: "pass",
    uploadTokenHash: "hash",
    contributorName: contributor,
    createdAt: completedAt,
    lastActivityAt: completedAt,
    completedAt,
  });
  return id;
}

async function unannounced() {
  return (await db.select({ id: files.id }).from(files).where(isNull(files.notifiedAt))).length;
}

describe("new-clips digest", () => {
  it("waits for a burst to go quiet, then sends one email", async () => {
    await athlete("matej");
    await clip("matej", T0 - 12 * MIN, "Coach Peter");
    await clip("matej", T0 - 2 * MIN);

    await announceNewClips(env, T0);
    expect(attempts).toHaveLength(0);

    // The newest clip is now 11 minutes old.
    await announceNewClips(env, T0 + 9 * MIN);
    expect(sent).toEqual([
      expect.objectContaining({ to: "matej@example.com", subject: "2 new clips on your Hop" }),
    ]);
    expect(await unannounced()).toBe(0);

    await announceNewClips(env, T0 + 20 * MIN);
    expect(attempts).toHaveLength(1);
  });

  it("doesn't wait more than an hour while uploads keep coming", async () => {
    await athlete("matej");
    await clip("matej", T0 - 61 * MIN);
    await clip("matej", T0 - 1 * MIN);

    await announceNewClips(env, T0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("2 new clips on your Hop");
  });

  it("retries a failed send with exactly the same clips and key", async () => {
    await athlete("matej");
    await clip("matej", T0 - 15 * MIN);
    await clip("matej", T0 - 15 * MIN);

    resend = failure;
    await announceNewClips(env, T0);
    expect(attempts).toHaveLength(1);
    const firstKey = attempts[0]?.key;
    expect(await unannounced()).toBe(2);

    // A newer clip arrives; it must not join the failed batch.
    await clip("matej", T0 + 1 * MIN, "Nina");
    resend = ok;
    await announceNewClips(env, T0 + 2 * MIN); // too soon to retry, Nina's clip not quiet yet
    expect(attempts).toHaveLength(1);

    await announceNewClips(env, T0 + 12 * MIN);
    expect(sent).toEqual([
      { to: "matej@example.com", key: firstKey, subject: "2 new clips on your Hop" },
      expect.objectContaining({ subject: "1 new clip on your Hop" }),
    ]);
    expect(sent[1]?.key).not.toBe(firstKey);
    expect(await unannounced()).toBe(0);
  });

  it("counts a batch as sent when Resend already used its key", async () => {
    await athlete("matej");
    await clip("matej", T0 - 15 * MIN);
    resend = () =>
      Response.json({ name: "invalid_idempotent_request", message: "…" }, { status: 409 });

    await announceNewClips(env, T0);
    expect(await unannounced()).toBe(0);
    await announceNewClips(env, T0 + 10 * MIN);
    expect(attempts).toHaveLength(1);
  });

  it("claims each clip once when runs overlap", async () => {
    await athlete("matej");
    await clip("matej", T0 - 15 * MIN);

    await Promise.all([announceNewClips(env, T0), announceNewClips(env, T0)]);
    expect(attempts).toHaveLength(1);
  });

  it("marks clips announced without emailing athletes who can't or don't want email", async () => {
    await athlete("opted-out", { emailNewClips: false });
    await athlete("unverified", { emailVerified: false });
    await athlete("no-email", { email: null });
    for (const id of ["opted-out", "unverified", "no-email"]) await clip(id, T0 - 15 * MIN);

    await announceNewClips(env, T0);
    expect(attempts).toHaveLength(0);
    expect(await unannounced()).toBe(0);
  });

  it("gives up on a batch that can't be confirmed within 23 hours", async () => {
    await athlete("matej");
    await clip("matej", T0 - 15 * MIN);
    resend = failure;
    await announceNewClips(env, T0);

    resend = ok;
    await announceNewClips(env, T0 + 24 * 60 * MIN);
    expect(attempts).toHaveLength(1);
    expect(await unannounced()).toBe(0);
  });

  it("retries the least recently tried batches first", async () => {
    // 26 athletes, one more than a run handles, all failing to send. "aaa"
    // sorts first, so only the ordering by last attempt can keep it waiting.
    for (let i = 0; i < 25; i++) {
      await athlete(`b${i}`);
      await clip(`b${i}`, T0 - 15 * MIN);
    }
    await athlete("aaa");
    await clip("aaa", T0 - 9.5 * MIN); // not quiet yet at T0
    resend = failure;
    await announceNewClips(env, T0); // claims and tries the 25 b's
    await announceNewClips(env, T0 + MIN); // claims and tries aaa
    const last = attempts.at(-1)?.to;
    expect(last).toBe("aaa@example.com");
    expect(attempts).toHaveLength(26);

    // Every batch is due for a retry; the 25 tried longest ago go first.
    await announceNewClips(env, T0 + 7 * MIN);
    expect(attempts.slice(26).map((a) => a.to)).not.toContain(last);

    // Next run, the one left over is first in line.
    resend = ok;
    await announceNewClips(env, T0 + 8 * MIN);
    expect(sent.map((a) => a.to)).toEqual([last]);
  });
});

describe("new clips on the phone", () => {
  const PHONE = "a".repeat(64);
  /** Names and titles are isolated, so right-to-left text can't reorder the sentence. */
  const i = (text: string) => `\u2068${text}\u2069`;

  beforeEach(async () => {
    forgetProviderToken();
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const der = new Uint8Array(
      (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
    );
    env = {
      ...env,
      APNS_KEY: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`,
      APNS_KEY_ID: "KEY1234567",
      APNS_ENVIRONMENT: "sandbox",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_BUNDLE_ID: "com.onmyhop.app",
    } as Env;
  });

  async function phone(
    userId: string,
    token = PHONE,
    environment: "sandbox" | "production" = "sandbox",
  ) {
    await db.insert(devices).values({ token, userId, environment, createdAt: T0, updatedAt: T0 });
  }

  async function event(ownerId: string, id: string, title: string) {
    await db.insert(hops).values({ id, ownerId, slug: id, title, createdAt: T0 });
  }

  it("pushes the digest to the athlete's phones, as the email says it", async () => {
    await athlete("matej");
    await phone("matej");
    await phone("matej", "b".repeat(64), "production");
    await event("matej", "hop-open", "Street Kings Prague");
    const first = await clip("matej", T0 - 15 * MIN, "Coach Peter");
    const second = await clip("matej", T0 - 14 * MIN, "Lea");
    await db.update(files).set({ hopId: "hop-open" }).where(eq(files.id, first));
    await db.update(files).set({ hopId: "hop-open" }).where(eq(files.id, second));

    await announceNewClips(env, T0);
    expect(pushes).toEqual([
      {
        token: PHONE,
        threadId: "hop-open",
        alert: {
          title: `2 new clips from ${i("Street Kings Prague")}`,
          body: `${i("Coach Peter")} and ${i("Lea")} sent you clips.`,
        },
        data: { hop: "clips", hopId: "hop-open" },
      },
    ]);
    expect(sent).toHaveLength(1);
  });

  it("says where clips from several events went", async () => {
    await athlete("matej");
    await phone("matej");
    await event("matej", "hop-open", "Street Kings Prague");
    const elsewhere = await clip("matej", T0 - 15 * MIN);
    await clip("matej", T0 - 14 * MIN);
    await db.update(files).set({ hopId: "hop-open" }).where(eq(files.id, elsewhere));

    await announceNewClips(env, T0);
    expect(pushes[0]).toMatchObject({
      threadId: "clips",
      alert: { title: "2 new clips on your Hop", body: `${i("Lea")} sent you clips.` },
      data: { hop: "clips" },
    });
  });

  it("pushes once, however often the email is retried", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    resend = failure;
    await announceNewClips(env, T0);
    await announceNewClips(env, T0 + 6 * MIN);
    resend = ok;
    await announceNewClips(env, T0 + 12 * MIN);
    expect(attempts).toHaveLength(3);
    expect(pushes).toHaveLength(1);
  });

  it("pushes once when runs overlap", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    await Promise.all([announceNewClips(env, T0), announceNewClips(env, T0)]);
    expect(pushes).toHaveLength(1);
  });

  it("pushes to athletes who turned email off, or have none", async () => {
    await athlete("no-email", { emailNewClips: false });
    await athlete("unverified", { emailVerified: false });
    for (const id of ["no-email", "unverified"]) {
      await phone(id, id === "no-email" ? "c".repeat(64) : "d".repeat(64));
      await clip(id, T0 - 15 * MIN);
    }
    await announceNewClips(env, T0);
    expect(attempts).toEqual([]);
    expect(pushes).toHaveLength(2);
    expect(await unannounced()).toBe(0);
  });

  it("doesn't push to athletes who turned it off", async () => {
    await athlete("matej", { pushNewClips: false });
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    await announceNewClips(env, T0);
    expect(pushes).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("leaves out clips Event mode's Live Activity counted", async () => {
    await athlete("matej");
    await phone("matej");
    await event("matej", "hop-open", "Street Kings Prague");
    // Before Event mode started: not counted, so pushed.
    const before = await clip("matej", T0 - 25 * MIN, "Early");
    // While it runs: counted on the Lock Screen already.
    const during = await clip("matej", T0 - 15 * MIN, "Coach Peter");
    // Another event: pushed.
    await clip("matej", T0 - 15 * MIN, "Lea");
    for (const id of [before, during]) {
      await db.update(files).set({ hopId: "hop-open" }).where(eq(files.id, id));
    }
    await db.insert(liveActivities).values({
      token: "e".repeat(64),
      userId: "matej",
      hopId: "hop-open",
      since: T0 - 20 * MIN,
      createdAt: T0 - 20 * MIN,
      expiresAt: T0 + 60 * MIN,
      pushedAt: T0 - 15 * MIN,
    });

    await announceNewClips(env, T0 + 50 * MIN);
    expect(pushes.map((push) => push.alert)).toEqual([
      { title: "2 new clips on your Hop", body: `${i("Early")} and ${i("Lea")} sent you clips.` },
    ]);
    // The email covers them all.
    expect(sent[0]?.subject).toBe("3 new clips on your Hop");
  });

  it("doesn't push when Event mode counted every clip", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    await db.insert(liveActivities).values({
      token: "e".repeat(64),
      userId: "matej",
      hopId: "hop-matej",
      since: T0 - 20 * MIN,
      createdAt: T0 - 20 * MIN,
      expiresAt: T0 + 60 * MIN,
      pushedAt: T0 - 15 * MIN,
    });
    await announceNewClips(env, T0);
    expect(pushes).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("pushes clips an Event mode update Apple refused never showed", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    // Registered, but no update got through.
    await db.insert(liveActivities).values({
      token: "e".repeat(64),
      userId: "matej",
      hopId: "hop-matej",
      since: T0 - 20 * MIN,
      createdAt: T0 - 20 * MIN,
      expiresAt: T0 + 60 * MIN,
    });
    // One got through, but before this clip.
    await clip("matej", T0 - 12 * MIN, "Later");
    await db.update(liveActivities).set({ pushedAt: T0 - 14 * MIN });
    await announceNewClips(env, T0);
    expect(pushes.map((push) => push.alert.body)).toEqual([`${i("Later")} sent you a clip.`]);
  });

  it("keeps fresh batches going while email retries keep timing out", async () => {
    // Three athletes whose emails keep failing, then one with new clips.
    for (const id of ["a", "b", "c"]) {
      await athlete(id);
      await clip(id, T0 - 15 * MIN);
    }
    resend = failure;
    await announceNewClips(env, T0);
    await athlete("fresh", { email: null });
    await phone("fresh");
    await clip("fresh", T0 + 2 * MIN);

    // Each retry times out after a minute: past half the run's budget,
    // retries stop, and the fresh batch is still claimed and pushed.
    let elapsed = 0;
    resend = () => {
      elapsed += 60 * 1000;
      return failure();
    };
    await announceNewClips(env, T0 + 15 * MIN, () => elapsed);
    expect(attempts.slice(3)).toHaveLength(2);
    expect(pushes).toHaveLength(1);
  });

  it("forgets a phone Apple says is gone", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    apns = () => Response.json({ reason: "Unregistered" }, { status: 410 });
    await announceNewClips(env, T0);
    expect(await db.select().from(devices)).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("keeps the email going when a push fails", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    apns = () => Response.json({ reason: "InternalServerError" }, { status: 500 });
    await announceNewClips(env, T0);
    expect(pushes).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(await unannounced()).toBe(0);
  });

  it("shows names cleaned, and only a signed-in sender's with an @", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN, "coach.peter\u200b\nX");
    // Older names, from before names were cleaned on the way in.
    await clip("matej", T0 - 15 * MIN, "\u200b@coach_official");
    const verified = await clip("matej", T0 - 15 * MIN, "@leo.flips");
    await athlete("leo");
    await db.update(files).set({ contributorUserId: "leo" }).where(eq(files.id, verified));
    await announceNewClips(env, T0);
    expect(pushes[0]?.alert.body).toBe(
      `${i("coach.peter X")}, ${i("coach_official")} and 1 other sent you clips.`,
    );
  });

  it("counts a name with nothing visible left as someone", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN, "Lea");
    await clip("matej", T0 - 15 * MIN, "\u3164\u200b");
    await announceNewClips(env, T0);
    expect(pushes[0]?.alert.body).toBe(`${i("Lea")} and 1 other sent you clips.`);
  });

  it("keeps the email going when a push can't be sent at all", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    // Event mode's registrations can't be read: the push gives up, the email goes.
    await env.DB.prepare("DROP TABLE live_activities").run();
    await announceNewClips(env, T0);
    expect(pushes).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(await unannounced()).toBe(0);
  });

  it("ignores Event mode registrations older than a Live Activity lasts", async () => {
    await athlete("matej");
    await phone("matej");
    await clip("matej", T0 - 15 * MIN);
    await db.insert(liveActivities).values({
      token: "e".repeat(64),
      userId: "matej",
      hopId: "hop-matej",
      since: T0 - 9 * 60 * MIN,
      createdAt: T0 - 9 * 60 * MIN,
      expiresAt: T0 + 60 * MIN,
    });
    await announceNewClips(env, T0);
    expect(pushes).toHaveLength(1);
  });
});
