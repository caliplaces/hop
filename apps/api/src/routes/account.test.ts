import { DEFAULT_HOP_SLUG, DEFAULT_HOP_TITLE, type Me } from "@hop/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, sweepAvatars } from "../cron";
import { getDb } from "../db";
import * as schema from "../db/schema";
import {
  files,
  hops,
  liveActivities,
  sessions,
  subscriptions,
  users,
  waitlist,
} from "../db/schema";
import { accountDeletedEmail } from "../email/account-deleted";
import type { Env } from "../env";
import worker from "../index";
import { deleteAccount, RECENT_MS } from "../lib/accounts";
import { randomToken, sha256Hex, signPayload } from "../lib/crypto";
import { thumbnailKey } from "../lib/files";
import { createTestD1 } from "../test/d1";
import { createTestR2 } from "../test/r2";

const DAY = 24 * 60 * 60 * 1000;
const AVATAR = "avatars/aaaaaaaaaaaaaaaaaaaaaa.jpg";

let env: Env;
let db: ReturnType<typeof getDb>;
let r2: ReturnType<typeof createTestR2>;
/** Alex's app session (a bearer token) and website session (a cookie). */
let appToken: string;
let webToken: string;
/** Bea's app session: another athlete, who must be left alone. */
let beaToken: string;
/** Work the routes left running after their response (emails). */
let pending: Promise<unknown>[];
/** Emails that reached Resend. */
let sent: { to: string[]; subject: string; text: string; idempotencyKey: string | null }[];

async function session(userId: string, kind: "app" | "web") {
  const token = kind === "app" ? `hs_${randomToken()}` : randomToken();
  const now = Date.now();
  await db
    .insert(sessions)
    .values({ id: await sha256Hex(token), userId, kind, createdAt: now, expiresAt: now + DAY });
  return token;
}

let fileNumber = 0;
async function clip(
  hopId: string,
  owner: string,
  { status = "complete" as "pending" | "complete", from = null as string | null } = {},
) {
  fileNumber += 1;
  const id = `fil_${fileNumber}`;
  const r2Key = `hops/${hopId}/${id}/original`;
  const upload = status === "pending" ? await r2.bucket.createMultipartUpload(r2Key) : null;
  const now = Date.now();
  await db.insert(files).values({
    id,
    hopId,
    ownerId: owner,
    r2Key,
    thumbKey: status === "complete" ? thumbnailKey({ hopId, id }) : null,
    originalName: "IMG.MOV",
    mime: "video/quicktime",
    size: 1000,
    partSize: 1000,
    partCount: 1,
    status,
    multipartUploadId: upload?.uploadId ?? null,
    passId: "pass",
    uploadTokenHash: "x",
    contributorName: from ? "@alex" : "Mia",
    contributorUserId: from,
    createdAt: now,
    lastActivityAt: now,
    completedAt: status === "complete" ? now : null,
  });
  if (status === "complete") {
    await r2.bucket.put(r2Key, new Uint8Array([1]));
    await r2.bucket.put(thumbnailKey({ hopId, id }), new Uint8Array([2]));
  }
  return id;
}

beforeEach(async () => {
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
    UPLOAD_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
  } as Env;
  db = getDb(DB);
  pending = [];
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      const body = JSON.parse(String(init?.body));
      sent.push({
        to: body.to,
        subject: body.subject,
        text: body.text,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      });
      return Response.json({ id: "email_1" });
    }),
  );

  const now = Date.now();
  await db.insert(users).values([
    {
      id: "usr_a",
      oidcSub: "sub-a",
      email: "alex@example.com",
      emailVerified: true,
      name: "Alex Caliplaces",
      displayName: "Alex Rider",
      handle: "alex",
      color: "mint",
      activeHopId: "hop_a",
      avatarKey: AVATAR,
      appAccountToken: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
      profileReviewedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "usr_b",
      oidcSub: "sub-b",
      email: "bea@example.com",
      emailVerified: true,
      name: "Bea",
      handle: "bea",
      activeHopId: "hop_b",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(hops).values([
    { id: "hop_a", ownerId: "usr_a", slug: "inbox", title: "Inbox", createdAt: now },
    { id: "hop_a2", ownerId: "usr_a", slug: "worlds", title: "Worlds", createdAt: now },
    { id: "hop_b", ownerId: "usr_b", slug: "inbox", title: "Inbox", createdAt: now },
  ]);
  await r2.bucket.put(AVATAR, new Uint8Array([9]));
  await clip("hop_a", "usr_a");
  await clip("hop_a2", "usr_a");
  await clip("hop_a", "usr_a", { status: "pending" });
  // A clip Alex sent Bea while signed in.
  await clip("hop_b", "usr_b", { from: "usr_a" });
  await db.insert(subscriptions).values({
    originalTransactionId: "1000000000000001",
    userId: "usr_a",
    productId: "hop_plus",
    environment: "Production",
    expiresAt: now + 30 * DAY,
    purchasedAt: now,
    signedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(liveActivities).values({
    token: "live-token",
    userId: "usr_a",
    hopId: "hop_a",
    since: now,
    createdAt: now,
    expiresAt: now + DAY,
  });
  appToken = await session("usr_a", "app");
  webToken = await session("usr_a", "web");
  beaToken = await session("usr_b", "app");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://onmyhop.com/api${path}`, init), env, {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext);
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const deleteMe = (headers: Record<string, string> = bearer(appToken)) =>
  call("/me", { method: "DELETE", headers: { "content-type": "application/json", ...headers } });
const meWith = async (headers: Record<string, string>) =>
  ((await (await call("/me", { headers })).json()) as { me: Me | null }).me;
const alex = () => db.select().from(users).where(eq(users.id, "usr_a")).get();

describe("deleting an account", () => {
  it("signs them out everywhere and erases everything that identifies them", async () => {
    const response = await deleteMe();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(await meWith(bearer(appToken))).toBeNull();
    expect(await meWith({ cookie: `hop_session=${webToken}` })).toBeNull();

    const row = await alex();
    expect(row).toMatchObject({
      oidcSub: "deleted:usr_a",
      email: null,
      emailVerified: false,
      name: null,
      displayName: null,
      avatarKey: null,
      activeHopId: null,
      appAccountToken: null,
      emailNewClips: false,
      profileReviewedAt: null,
      // Kept, so nobody else can take the link.
      handle: "alex",
    });
    expect(row?.deletedAt).toBeTypeOf("number");

    expect(r2.objects.has(AVATAR)).toBe(false);
    expect(await db.select().from(subscriptions)).toEqual([]);
    expect(await db.select().from(liveActivities)).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, "usr_a"))).toEqual([]);
    const theirHops = await db.select().from(hops).where(eq(hops.ownerId, "usr_a"));
    expect(theirHops.map((hop) => hop.status)).toEqual(["closed", "closed"]);
    const theirClips = await db.select().from(files).where(eq(files.ownerId, "usr_a"));
    expect(theirClips.map((file) => file.status)).toEqual(["deleting", "deleting", "deleting"]);
  });

  it("leaves other athletes alone, keeping the clips they were sent but not who sent them", async () => {
    await deleteMe();
    expect(await meWith(bearer(beaToken))).toMatchObject({ id: "usr_b", handle: "bea" });
    const sentToBea = await db.select().from(files).where(eq(files.hopId, "hop_b")).get();
    expect(sentToBea).toMatchObject({ status: "complete", contributorUserId: null });
  });

  it("clears the website's cookie", async () => {
    const response = await deleteMe({
      cookie: `hop_session=${webToken}`,
      origin: "https://onmyhop.com",
    });
    expect(response.status).toBe(200);
    // Last word on the cookie: gone (a renewal may come first).
    expect(response.headers.getSetCookie().at(-1)).toMatch(/^hop_session=;.*Max-Age=0/);
    expect((await alex())?.deletedAt).toBeTypeOf("number");
  });

  it("can't be done from another site with the website's cookie", async () => {
    const response = await call("/me", {
      method: "DELETE",
      headers: { cookie: `hop_session=${webToken}`, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect((await alex())?.deletedAt).toBeNull();
  });

  it("needs a signed-in athlete", async () => {
    expect((await deleteMe({})).status).toBe(401);
    expect((await alex())?.deletedAt).toBeNull();
  });

  it("keeps the handle: the page is gone and nobody else can claim it", async () => {
    await deleteMe();
    expect((await call("/h/alex")).status).toBe(404);
    expect((await call("/h/alex/worlds")).status).toBe(404);
    const check = (await (await call("/handles/alex")).json()) as { available: boolean };
    expect(check.available).toBe(false);

    const now = Date.now();
    await db
      .insert(users)
      .values({ id: "usr_c", oidcSub: "sub-c", createdAt: now, updatedAt: now });
    const claim = await call("/me/handle", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(await session("usr_c", "app")) },
      body: JSON.stringify({ handle: "alex" }),
    });
    expect(claim.status).toBe(409);
    expect(((await claim.json()) as { error: string }).error).toBe("handle_taken");
  });

  it("keeps the page gone even if a request under way gave them an active hop back", async () => {
    await deleteMe();
    await db.update(users).set({ activeHopId: "hop_a" }).where(eq(users.id, "usr_a"));
    expect((await call("/h/alex")).status).toBe(404);
  });

  it("refuses uploads into their hops", async () => {
    await deleteMe();
    const pass = await signPayload(env.SESSION_SECRET, {
      purpose: "hop-pass",
      exp: Date.now() + DAY,
      hopId: "hop_a",
      passId: "pass-1",
    });
    const response = await call("/hops/hop_a/uploads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hop-pass": pass },
      body: JSON.stringify({ name: "IMG.MOV", size: 5_000_000, type: "video/quicktime" }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe("hop_closed");
  });

  it("refuses an upload that read the hop just before the account was deleted", async () => {
    // Deletes the account at the last moment: as the upload reserves its
    // place, after it found the hop open.
    const raw = env.DB;
    const elsewhere = drizzle(raw, { schema });
    let deleted = false;
    const hookRun = <T extends object>(statement: T): T =>
      new Proxy(statement, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (key === "bind") {
            return (...args: unknown[]) =>
              hookRun((value as (...a: unknown[]) => T).apply(target, args));
          }
          if (key === "run") {
            return async () => {
              if (!deleted) {
                deleted = true;
                await deleteAccount(elsewhere, "usr_a");
              }
              return (value as () => Promise<unknown>).apply(target);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    env.DB = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "prepare") {
          return (query: string) => {
            const statement = (value as (q: string) => object).call(target, query);
            return /^\s*insert into "files"/.test(query) ? hookRun(statement) : statement;
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const pass = await signPayload(env.SESSION_SECRET, {
      purpose: "hop-pass",
      exp: Date.now() + DAY,
      hopId: "hop_a",
      passId: "pass-2",
    });
    const response = await call("/hops/hop_a/uploads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hop-pass": pass },
      body: JSON.stringify({ name: "IMG.MOV", size: 5_000_000, type: "video/quicktime" }),
    });
    expect(deleted).toBe(true);
    expect(response.status).toBe(403);
    const theirs = await db.select().from(files).where(eq(files.ownerId, "usr_a"));
    expect(theirs.every((file) => file.status === "deleting")).toBe(true);
  });

  it("emails a confirmation once, to the address they had", async () => {
    await deleteMe();
    await Promise.all(pending);
    expect(sent).toEqual([
      expect.objectContaining({
        to: ["alex@example.com"],
        subject: "Your Hop account is deleted",
        idempotencyKey: "account-deleted/usr_a",
      }),
    ]);

    // Already deleted: nothing more to do, and no second email.
    expect(await deleteAccount(db, "usr_a")).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("doesn't email an unverified address", async () => {
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, "usr_a"));
    await deleteMe();
    await Promise.all(pending);
    expect(sent).toEqual([]);
  });

  it("drops the real name from clips they sent before claiming a handle", async () => {
    // Sent while signed in without a handle: the clip carries their name.
    await db
      .update(files)
      .set({ contributorName: "Alex Caliplaces" })
      .where(eq(files.contributorUserId, "usr_a"));
    await deleteMe();
    const sentToBea = await db.select().from(files).where(eq(files.hopId, "hop_b")).get();
    expect(sentToBea).toMatchObject({ contributorUserId: null, contributorName: null });
  });

  it("refuses a session of the deleted account, however it came to be", async () => {
    await deleteMe();
    // As if a sign-in under way made one just after.
    const late = await session("usr_a", "app");
    expect(await meWith(bearer(late))).toBeNull();
    const created = await call("/me/hops", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(late) },
      body: JSON.stringify({ title: "Sneaky" }),
    });
    expect(created.status).toBe(401);
  });

  it("refuses a handle claim that was under way as the account was deleted", async () => {
    const now = Date.now();
    await db.insert(users).values({
      id: "usr_c",
      oidcSub: "sub-c",
      email: "cleo@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const cleo = await session("usr_c", "app");
    // The account is deleted at the last moment, after the claim checked it.
    const raw = env.DB;
    const elsewhere = drizzle(raw, { schema });
    let deleted = false;
    env.DB = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "batch") {
          return async (statements: unknown) => {
            if (!deleted) {
              deleted = true;
              await deleteAccount(elsewhere, "usr_c");
            }
            return (value as (s: unknown) => Promise<unknown>).call(target, statements);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const claim = await call("/me/handle", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(cleo) },
      body: JSON.stringify({ handle: "cleo" }),
    });
    expect(deleted).toBe(true);
    expect(claim.status).toBe(409);
    env.DB = raw;
    expect(await db.select().from(users).where(eq(users.id, "usr_c")).get()).toMatchObject({
      handle: null,
      activeHopId: null,
    });
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_c"))).toEqual([]);
    await Promise.all(pending);
    expect(sent.map((email) => email.subject)).not.toContain(expect.stringContaining("live"));
  });

  it("claims a handle, with its hop, as before", async () => {
    const now = Date.now();
    await db
      .insert(users)
      .values({ id: "usr_c", oidcSub: "sub-c", createdAt: now, updatedAt: now });
    const claim = await call("/me/handle", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(await session("usr_c", "app")) },
      body: JSON.stringify({ handle: "cleo", color: "grape" }),
    });
    expect(claim.status).toBe(200);
    const row = await db.select().from(users).where(eq(users.id, "usr_c")).get();
    expect(row).toMatchObject({ handle: "cleo", color: "grape" });
    const hop = await db.select().from(hops).where(eq(hops.ownerId, "usr_c")).get();
    expect(hop).toMatchObject({
      id: row?.activeHopId,
      slug: DEFAULT_HOP_SLUG,
      title: DEFAULT_HOP_TITLE,
      status: "open",
    });
    expect(hop?.createdAt).toBeGreaterThanOrEqual(now);
    // Only once.
    const again = await call("/me/handle", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(await session("usr_c", "app")) },
      body: JSON.stringify({ handle: "cleo2" }),
    });
    expect(again.status).toBe(409);
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_c"))).toHaveLength(1);
  });

  it("takes them off the launch waitlist, if their address is verified", async () => {
    const now = Date.now();
    await db.insert(waitlist).values([
      { email: "alex@example.com", createdAt: now },
      { email: "bea@example.com", createdAt: now },
    ]);
    await db.update(users).set({ email: " Alex@Example.com " }).where(eq(users.id, "usr_a"));
    await deleteMe();
    const left = await db.select({ email: waitlist.email }).from(waitlist);
    expect(left.map((row) => row.email)).toEqual(["bea@example.com"]);
  });

  it("leaves the waitlist alone for an unverified address", async () => {
    await db.insert(waitlist).values({ email: "alex@example.com", createdAt: Date.now() });
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, "usr_a"));
    await deleteMe();
    expect(await db.select().from(waitlist)).toHaveLength(1);
  });

  it("emails once when two deletions race", async () => {
    const [first, second] = await Promise.all([deleteMe(), deleteMe()]);
    expect([first.status, second.status]).toContain(200);
    await Promise.all(pending);
    expect(sent).toHaveLength(1);
  });

  it("doesn't email when there's no address", async () => {
    await db.update(users).set({ email: null }).where(eq(users.id, "usr_a"));
    await deleteMe();
    await Promise.all(pending);
    expect(sent).toEqual([]);
  });

  it("lets the same Caliplaces account start again as a new account", async () => {
    await deleteMe();
    const now = Date.now();
    // What a new sign-in does: no account has this Caliplaces ID any more.
    const fresh = await db
      .insert(users)
      .values({ id: "usr_new", oidcSub: "sub-a", createdAt: now, updatedAt: now })
      .returning()
      .get();
    expect(fresh).toMatchObject({ id: "usr_new", handle: null });
  });
});

describe("the cleanup, after an account is deleted", () => {
  it("removes their clips, aborts uploads under way, then their hops, and keeps the tombstone", async () => {
    await deleteMe();
    await cleanup(env);

    expect(await db.select().from(files).where(eq(files.ownerId, "usr_a"))).toEqual([]);
    expect([...r2.objects.keys()].filter((key) => key.startsWith("hops/hop_a"))).toEqual([]);
    expect(r2.multipart.size).toBe(0);
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_a"))).toEqual([]);
    // Bea's hop and the clip Alex sent her stay.
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_b"))).toHaveLength(1);
    expect(await db.select().from(files).where(eq(files.hopId, "hop_b"))).toHaveLength(1);
    expect(await alex()).toMatchObject({ handle: "alex", email: null });
  });

  it("keeps a hop until every clip in it is gone", async () => {
    await deleteMe();
    r2.faults.deleteFails = true;
    await cleanup(env);
    const left = await db.select().from(files).where(eq(files.ownerId, "usr_a"));
    expect(left.length).toBeGreaterThan(0);
    const leftHops = await db.select({ id: hops.id }).from(hops).where(eq(hops.ownerId, "usr_a"));
    expect(leftHops.map((hop) => hop.id).sort()).toEqual(
      [...new Set(left.map((file) => file.hopId))].sort(),
    );

    // A later run, with R2 back, finishes. Failed removals wait ten minutes.
    await db.update(files).set({ lastActivityAt: 0 }).where(eq(files.ownerId, "usr_a"));
    await cleanup(env);
    expect(await db.select().from(files).where(eq(files.ownerId, "usr_a"))).toEqual([]);
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_a"))).toEqual([]);
  });

  it("erases again whatever a request under way left behind", async () => {
    await deleteMe();
    // As if requests that started before the deletion finished after it.
    const now = Date.now();
    await db
      .update(users)
      .set({ displayName: "Alex again", avatarKey: AVATAR, appAccountToken: "token" })
      .where(eq(users.id, "usr_a"));
    await session("usr_a", "app");
    await db.insert(liveActivities).values({
      token: "late-token",
      userId: "usr_a",
      hopId: "hop_a",
      since: now,
      createdAt: now,
      expiresAt: now + DAY,
    });
    await db.update(hops).set({ status: "open" }).where(eq(hops.id, "hop_a"));
    await clip("hop_a", "usr_a");

    await cleanup(env);
    expect(await alex()).toMatchObject({
      displayName: null,
      avatarKey: null,
      appAccountToken: null,
    });
    expect(await db.select().from(sessions).where(eq(sessions.userId, "usr_a"))).toEqual([]);
    expect(await db.select().from(liveActivities)).toEqual([]);
    expect(await db.select().from(files).where(eq(files.ownerId, "usr_a"))).toEqual([]);
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_a"))).toEqual([]);
  });

  it("leaves accounts that weren't deleted alone", async () => {
    // Bea, who isn't deleting anything, has a bit of everything.
    const now = Date.now();
    await db.insert(subscriptions).values({
      originalTransactionId: "1000000000000002",
      userId: "usr_b",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: now + 30 * DAY,
      purchasedAt: now,
      signedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(liveActivities).values({
      token: "bea-token",
      userId: "usr_b",
      hopId: "hop_b",
      since: now,
      createdAt: now,
      expiresAt: now + DAY,
    });
    await clip("hop_b", "usr_b", { status: "pending" });

    await deleteMe();
    await cleanup(env);

    expect(await db.select().from(users).where(eq(users.id, "usr_b")).get()).toMatchObject({
      deletedAt: null,
      email: "bea@example.com",
      name: "Bea",
      handle: "bea",
      activeHopId: "hop_b",
    });
    expect(await db.select().from(sessions).where(eq(sessions.userId, "usr_b"))).toHaveLength(1);
    expect(
      await db.select().from(subscriptions).where(eq(subscriptions.userId, "usr_b")),
    ).toHaveLength(1);
    expect(
      await db.select().from(liveActivities).where(eq(liveActivities.userId, "usr_b")),
    ).toHaveLength(1);
    expect((await db.select().from(hops).where(eq(hops.id, "hop_b")).get())?.status).toBe("open");
    const beas = await db.select().from(files).where(eq(files.ownerId, "usr_b"));
    expect(beas.map((file) => file.status).sort()).toEqual(["complete", "pending"]);
  });

  it("carries on with the rest when erasing deleted accounts fails", async () => {
    await deleteMe();
    const now = Date.now();
    await db.insert(sessions).values({
      id: "expired",
      userId: "usr_b",
      kind: "app",
      createdAt: now - 2 * DAY,
      expiresAt: now - DAY,
    });
    // D1 has a moment during the erasure's batch.
    const raw = env.DB;
    let failed = false;
    env.DB = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key === "batch" && !failed) {
          return async () => {
            failed = true;
            throw new Error("D1 is having a moment");
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await cleanup(env);
    expect(failed).toBe(true);
    expect(await db.select().from(sessions).where(eq(sessions.id, "expired"))).toEqual([]);
    // The clips marked when the account was deleted were still removed.
    expect(await db.select().from(files).where(eq(files.ownerId, "usr_a"))).toEqual([]);
  });

  it("keeps erasing for a week, and the photo written late goes too", async () => {
    // Deleted six days ago; a late write lands now.
    await deleteMe();
    await db
      .update(users)
      .set({ deletedAt: Date.now() - RECENT_MS + DAY })
      .where(eq(users.id, "usr_a"));
    const now = Date.now();
    const late = "avatars/bbbbbbbbbbbbbbbbbbbbbb.jpg";
    await r2.bucket.put(late, new Uint8Array([9]));
    await db.update(users).set({ avatarKey: late }).where(eq(users.id, "usr_a"));
    await db.insert(subscriptions).values({
      originalTransactionId: "1000000000000003",
      userId: "usr_a",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: now + 30 * DAY,
      purchasedAt: now,
      signedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await cleanup(env);
    expect((await alex())?.avatarKey).toBeNull();
    expect(await db.select().from(subscriptions)).toEqual([]);
    // Unreferenced now, the photo goes with the sweep once it's an hour old.
    await sweepAvatars(env, Date.now() + 2 * 60 * 60 * 1000);
    expect(r2.objects.has(late)).toBe(false);
  });

  it("clears the sender of a clip sent while the account was being deleted", async () => {
    await deleteMe();
    // Nora had no handle, so her clip carried her real name.
    await clip("hop_b", "usr_b", { from: "usr_a" });
    await db
      .update(files)
      .set({ contributorName: "Alex Caliplaces" })
      .where(eq(files.contributorUserId, "usr_a"));
    await cleanup(env);
    const sent = await db.select().from(files).where(eq(files.hopId, "hop_b"));
    expect(sent.every((file) => file.contributorUserId === null)).toBe(true);
    expect(sent.map((file) => file.contributorName).sort()).toEqual(["@alex", null].sort());
  });
});

describe("the account deleted email", () => {
  it("says what went, what stays reserved, and what to do if it wasn't them", async () => {
    const email = await accountDeletedEmail({ appUrl: "https://onmyhop.com", handle: "alex" });
    expect(email.subject).toBe("Your Hop account is deleted");
    expect(email.text).toContain("Your Hop account, onmyhop.com/alex, is deleted.");
    // Clips are queued for removal, not gone yet: it doesn't claim otherwise.
    expect(email.text).toContain("your clips are being removed");
    expect(email.text).toContain("Nobody can take onmyhop.com/alex again, you included");
    expect(email.text).toContain("Clips you sent other athletes stay with them, under @alex.");
    expect(email.text).toContain("Change your Caliplaces password");
    expect(email.text).toContain("deleting your account doesn’t cancel it");
    expect(email.html).toContain("Your Hop account is deleted");
  });

  it("reads right without a handle", async () => {
    const email = await accountDeletedEmail({ appUrl: "https://onmyhop.com", handle: null });
    expect(email.text).toContain(
      "Your Hop account is deleted. Your name, email and photo are gone",
    );
    expect(email.text).toContain("stay with them, without your name.");
    expect(email.text).not.toContain("Nobody can take");
  });
});
