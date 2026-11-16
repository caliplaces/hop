import type { AdminStats } from "@hop/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../db";
import { files, hops, sessions, subscriptions, users, waitlist } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { randomToken, sha256Hex } from "../lib/crypto";
import { adminStats } from "../stats";
import { createTestD1 } from "../test/d1";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;
const NOW = Date.UTC(2026, 10, 16, 12);

let env: Env;
let db: ReturnType<typeof getDb>;

async function signIn(userId: string) {
  const token = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId,
    kind: "app",
    createdAt: Date.now(),
    expiresAt: Date.now() + DAY,
  });
  return token;
}

function stats(token?: string) {
  return worker.fetch(
    new Request("https://onmyhop.com/api/admin/stats", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    env,
    {} as ExecutionContext,
  );
}

async function athlete(
  id: string,
  createdAt: number,
  extra: Partial<typeof users.$inferInsert> = {},
) {
  await db.insert(users).values({
    id,
    oidcSub: `sub-${id}`,
    handle: id,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });
  await db
    .insert(hops)
    .values({ id: `hop_${id}`, ownerId: id, slug: "inbox", title: "Inbox", createdAt });
}

let fileNumber = 0;
async function clip(
  ownerId: string,
  completedAt: number,
  size: number,
  extra: Partial<typeof files.$inferInsert> = {},
) {
  fileNumber += 1;
  await db.insert(files).values({
    id: `fil_${fileNumber}`,
    hopId: `hop_${ownerId}`,
    ownerId,
    r2Key: `k${fileNumber}`,
    originalName: "IMG.MOV",
    mime: "video/quicktime",
    size,
    partSize: size,
    partCount: 1,
    status: "complete",
    passId: `pass_${fileNumber}`,
    uploadTokenHash: "x",
    createdAt: completedAt,
    lastActivityAt: completedAt,
    completedAt,
    ...extra,
  });
}

beforeEach(async () => {
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    ADMIN_USER_IDS: " usr_team ,usr_other",
  } as Env;
  db = getDb(DB);
});

describe("the stats page", () => {
  it("is only for Hop's team: anyone else finds nothing there", async () => {
    await athlete("usr_team", NOW);
    await athlete("usr_alex", NOW);
    expect((await stats()).status).toBe(401);
    expect((await stats(await signIn("usr_alex"))).status).toBe(404);
    const response = await stats(await signIn("usr_team"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as AdminStats).athletes.total).toBe(2);

    env = { ...env, ADMIN_USER_IDS: undefined } as Env;
    expect((await stats(await signIn("usr_team"))).status).toBe(404);
  });

  it("counts athletes, how many came and how many are around", async () => {
    await athlete("old", NOW - 60 * DAY);
    await athlete("week", NOW - 3 * DAY);
    await athlete("today", NOW - HOUR);
    // Not athletes: no handle yet, or deleted.
    await db
      .insert(users)
      .values({ id: "nohandle", oidcSub: "s1", createdAt: NOW, updatedAt: NOW });
    await athlete("gone", NOW - 2 * DAY, { deletedAt: NOW - DAY });
    // Opened the app an hour ago (app sessions renew daily); a website
    // session last renewed 20 days ago.
    await db.insert(sessions).values([
      {
        id: "s_app",
        userId: "old",
        kind: "app",
        createdAt: NOW - 50 * DAY,
        expiresAt: NOW - HOUR + 90 * DAY,
      },
      {
        id: "s_web",
        userId: "week",
        kind: "web",
        createdAt: NOW - 20 * DAY,
        expiresAt: NOW - 20 * DAY + 30 * DAY,
      },
    ]);

    const result = await adminStats(db, NOW);
    expect(result.athletes).toEqual({
      total: 3,
      new: { day: 1, week: 2, month: 2 },
      active: { day: 1, week: 1, month: 2 },
      deleted: 1,
    });
  });

  it("counts events, clips, senders and what's stored, by plan", async () => {
    await athlete("alex", NOW - 60 * DAY);
    await athlete("bea", NOW - 60 * DAY);
    await db.insert(hops).values([
      { id: "hop_jam", ownerId: "alex", slug: "jam", title: "Jam", createdAt: NOW - 2 * DAY },
      { id: "hop_old", ownerId: "bea", slug: "nats", title: "Nats", createdAt: NOW - 40 * DAY },
    ]);
    await db.insert(subscriptions).values({
      originalTransactionId: "tx",
      userId: "bea",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: NOW + 30 * DAY,
      purchasedAt: NOW - DAY,
      signedAt: NOW - DAY,
      createdAt: NOW - DAY,
      updatedAt: NOW - DAY,
    });
    // The same browser twice, a signed-in sender, and one more.
    await clip("alex", NOW - HOUR, 10 * MB, { senderKey: "browser1" });
    await clip("alex", NOW - 2 * HOUR, 20 * MB, { senderKey: "browser1" });
    await clip("bea", NOW - 3 * DAY, 30 * MB, { contributorUserId: "alex" });
    await clip("bea", NOW - 40 * DAY, 40 * MB);
    await clip("alex", NOW - 5 * DAY, 5 * MB, { status: "held" });
    // Neither kept nor counted as a clip: an upload under way, one being removed.
    await clip("alex", NOW, 7 * MB, { status: "pending", completedAt: null });
    await clip("alex", NOW - DAY, 9 * MB, { status: "deleting" });
    await db.insert(waitlist).values([
      { email: "a@example.com", createdAt: NOW },
      { email: "b@example.com", createdAt: NOW },
    ]);

    const result = await adminStats(db, NOW);
    expect(result.events).toEqual({ total: 2, new: { day: 0, week: 1, month: 1 } });
    expect(result.clips).toEqual({ total: 5, new: { day: 2, week: 4, month: 4 } });
    expect(result.senders.day).toBe(1);
    expect(result.senders.week).toBe(4);
    expect(result.storage).toEqual({
      bytes: 105 * MB,
      pendingBytes: 7 * MB,
      freeBytes: 35 * MB,
      plusBytes: 70 * MB,
    });
    expect(result.plus.subscribers).toBe(1);
    expect(result.waitlist).toBe(2);
  });

  it("has the last 30 days, day by day", async () => {
    await athlete("alex", NOW - HOUR);
    await clip("alex", NOW - HOUR, 3 * MB);
    await clip("alex", NOW - DAY, 2 * MB);
    const { daily } = await adminStats(db, NOW);
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)).toEqual({
      day: "2026-11-16",
      athletes: 1,
      events: 0,
      clips: 1,
      bytes: 3 * MB,
    });
    expect(daily.at(-2)).toMatchObject({ day: "2026-11-15", clips: 1, bytes: 2 * MB });
    expect(daily[0]?.day).toBe("2026-10-18");
  });
});
