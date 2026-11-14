import { isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { files, hops, users } from "./db/schema";
import type { Env } from "./env";
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const headers = init.headers as Record<string, string>;
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
