import type { Block } from "@hop/shared";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "../cron";
import { getDb } from "../db";
import { blocks, files, hops, reports, sessions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { deleteAccount } from "../lib/accounts";
import { randomToken, sha256Hex, signPayload } from "../lib/crypto";
import { HOLD_MS } from "../lib/files";
import { ipRateKey } from "../lib/http";
import { announceReports } from "../reports";
import { createTestD1 } from "../test/d1";
import { createTestR2 } from "../test/r2";

const DAY = 24 * 60 * 60 * 1000;

let env: Env;
let db: ReturnType<typeof getDb>;
let r2: ReturnType<typeof createTestR2>;
let alexToken: string;
let beaToken: string;
/** Whether the report limiter lets the next request through, and the keys it was asked about. */
let allowReports: boolean;
let limitedKeys: string[];
/** Whether Turnstile passes the next token. */
let human: boolean;
/** Whether Resend accepts the next email. */
let resendUp: boolean;
let sent: { to: string[]; subject: string; text: string; html: string; key: string | null }[];
/** The anonymous troll's browser key, and the clip they sent Alex. */
let trollKey: string;
let trollClip: string;

let fileNumber = 0;
async function clip(
  hopId: string,
  owner: string,
  from: {
    userId?: string;
    senderKey?: string | null;
    name?: string;
    status?: "pending" | "complete";
  } = {},
) {
  fileNumber += 1;
  const id = `fil_${fileNumber}`;
  const now = Date.now();
  const status = from.status ?? "complete";
  const r2Key = `hops/${hopId}/${id}/original`;
  const upload = status === "pending" ? await r2.bucket.createMultipartUpload(r2Key) : null;
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
    status,
    multipartUploadId: upload?.uploadId ?? null,
    passId: "pass",
    uploadTokenHash: "x",
    contributorName: from.name ?? "Mia",
    contributorUserId: from.userId ?? null,
    senderKey: from.senderKey ?? null,
    note: "look at this",
    createdAt: now,
    lastActivityAt: now,
    completedAt: status === "complete" ? now : null,
  });
  if (status === "complete") await r2.bucket.put(r2Key, new Uint8Array([1]));
  return id;
}

async function session(userId: string) {
  const token = `hs_${randomToken()}`;
  const now = Date.now();
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId,
    kind: "app",
    createdAt: now,
    expiresAt: now + DAY,
  });
  return token;
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
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    REPORTS_EMAIL: "reports@example.com",
    REPORT_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limitedKeys.push(key);
        return { success: allowReports };
      },
    } as RateLimit,
    UPLOAD_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
  } as Env;
  db = getDb(DB);
  allowReports = true;
  limitedKeys = [];
  human = true;
  resendUp = true;
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
        const action =
          (init?.body as FormData | undefined)?.get("response") === "upload-token"
            ? "upload"
            : "report";
        return Response.json({ success: human, hostname: "onmyhop.com", action });
      }
      expect(url).toBe("https://api.resend.com/emails");
      if (!resendUp)
        return Response.json(
          { name: "rate_limit_exceeded", message: "Slow down" },
          { status: 429 },
        );
      const body = JSON.parse(String(init?.body));
      sent.push({
        to: body.to,
        subject: body.subject,
        text: body.text,
        html: body.html,
        key: new Headers(init?.headers).get("idempotency-key"),
      });
      return Response.json({ id: "email_1" });
    }),
  );

  const now = Date.now();
  await db.insert(users).values([
    {
      id: "usr_a",
      oidcSub: "sub-a",
      handle: "alex",
      activeHopId: "hop_a",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "usr_b",
      oidcSub: "sub-b",
      handle: "bea",
      activeHopId: "hop_b",
      createdAt: now,
      updatedAt: now,
    },
    { id: "usr_n", oidcSub: "sub-n", name: "Nora Realname", createdAt: now, updatedAt: now },
  ]);
  await db.insert(hops).values([
    { id: "hop_a", ownerId: "usr_a", slug: "inbox", title: "Inbox", createdAt: now },
    { id: "hop_b", ownerId: "usr_b", slug: "inbox", title: "Inbox", createdAt: now },
  ]);
  trollKey = randomToken();
  trollClip = await clip("hop_a", "usr_a", { senderKey: await sha256Hex(trollKey), name: "Troll" });
  alexToken = await session("usr_a");
  beaToken = await session("usr_b");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  ip = "203.0.113.7",
) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...init.headers },
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
  );
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (path: string, body: unknown, headers: Record<string, string> = {}, ip?: string) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers }, ip);
const cookieFor = (key: string) => ({ cookie: `hop_sender=${key}` });
const status = async (id: string) =>
  (await db.select({ status: files.status }).from(files).where(eq(files.id, id)).get())?.status;

/** A real upload pass from the pass route, for a browser with this key (or none yet). */
async function pass(hopId: string, headers: Record<string, string> = {}) {
  const response = await post(`/hops/${hopId}/pass`, { turnstileToken: "upload-token" }, headers);
  return {
    response,
    pass: response.ok ? ((await response.json()) as { pass: string }).pass : null,
  };
}

/** Starts an upload under `withPass`, or a pass from before senders were named. */
async function upload(
  hopId: string,
  { withPass, headers = {} }: { withPass?: string; headers?: Record<string, string> } = {},
) {
  const used =
    withPass ??
    (await signPayload(env.SESSION_SECRET, {
      purpose: "hop-pass",
      exp: Date.now() + DAY,
      hopId,
      passId: randomToken(12),
    }));
  return call(`/hops/${hopId}/uploads`, {
    method: "POST",
    body: JSON.stringify({ name: "IMG.MOV", size: 5_000_000, type: "video/quicktime" }),
    headers: { "x-hop-pass": used, ...headers },
  });
}

describe("reporting a clip", () => {
  it("records it, keeping what the team needs, and holds the clip for them", async () => {
    const response = await post(
      `/me/files/${trollClip}/report`,
      { reason: "harassment", note: "Keeps sending this" },
      as(alexToken),
    );
    expect(response.status).toBe(200);
    expect(await db.select().from(reports).get()).toMatchObject({
      kind: "clip",
      reason: "harassment",
      note: "Keeps sending this",
      reporterId: "usr_a",
      fileId: trollClip,
      contributorName: "Troll",
      senderKey: await sha256Hex(trollKey),
      clipNote: "look at this",
      clipName: "IMG.MOV",
      subjectUserId: null,
      emailedAt: null,
    });
    const held = await db
      .select({ until: files.heldUntil })
      .from(files)
      .where(eq(files.id, trollClip))
      .get();
    expect(held?.until).toBeGreaterThan(Date.now() + HOLD_MS - 60_000);
    expect(limitedKeys).toEqual(["report:usr_a"]);
    // Nothing is emailed from the request itself.
    expect(sent).toEqual([]);
  });

  it("counts reporting the same clip twice as once", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "spam" }, as(alexToken));
    expect(
      (await post(`/me/files/${trollClip}/report`, { reason: "other" }, as(alexToken))).status,
    ).toBe(200);
    expect(await db.select().from(reports)).toHaveLength(1);
  });

  it("names the account when the sender was signed in", async () => {
    const fileId = await clip("hop_a", "usr_a", { userId: "usr_b", name: "@bea" });
    await post(`/me/files/${fileId}/report`, { reason: "spam" }, as(alexToken));
    expect((await db.select().from(reports).get())?.subjectUserId).toBe("usr_b");
  });

  it("is only for clips sent to them", async () => {
    expect(
      (await post(`/me/files/${trollClip}/report`, { reason: "spam" }, as(beaToken))).status,
    ).toBe(404);
    expect(await db.select().from(reports)).toEqual([]);
  });

  it("needs a reason from the list, and a short note", async () => {
    expect(
      (await post(`/me/files/${trollClip}/report`, { reason: "boring" }, as(alexToken))).status,
    ).toBe(400);
    const long = { reason: "other", note: "x".repeat(501) };
    expect((await post(`/me/files/${trollClip}/report`, long, as(alexToken))).status).toBe(400);
    expect(await db.select().from(reports)).toEqual([]);
  });

  it("needs a signed-in athlete, and is rate limited", async () => {
    expect((await post(`/me/files/${trollClip}/report`, { reason: "spam" })).status).toBe(401);
    allowReports = false;
    expect(
      (await post(`/me/files/${trollClip}/report`, { reason: "spam" }, as(alexToken))).status,
    ).toBe(429);
    expect(await db.select().from(reports)).toEqual([]);
  });
});

describe("a reported clip", () => {
  it("is only hidden when deleted, until the team's had a month to look", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "sexual" }, as(alexToken));
    expect(
      (await call(`/me/files/${trollClip}`, { method: "DELETE", headers: as(alexToken) })).status,
    ).toBe(200);
    expect(await status(trollClip)).toBe("held");
    const inbox = (await (
      await call("/me/files?hopId=hop_a", { headers: as(alexToken) })
    ).json()) as {
      files: { id: string }[];
    };
    expect(inbox.files.map((file) => file.id)).not.toContain(trollClip);

    await cleanup(env);
    expect(await status(trollClip)).toBe("held");
    expect(r2.objects.has(`hops/hop_a/${trollClip}/original`)).toBe(true);

    // Once the hold is over, the next cleanup removes it.
    await db
      .update(files)
      .set({ heldUntil: Date.now() - 1 })
      .where(eq(files.id, trollClip));
    await cleanup(env);
    expect(await status(trollClip)).toBeUndefined();
    expect(r2.objects.has(`hops/hop_a/${trollClip}/original`)).toBe(false);
  });

  it("is held through the athlete deleting their account", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "sexual" }, as(alexToken));
    await deleteAccount(db, "usr_a");
    await cleanup(env);
    expect(await status(trollClip)).toBe("held");
    // Their hop stays only as long as the clip does.
    expect(await db.select().from(hops).where(eq(hops.id, "hop_a"))).toHaveLength(1);
  });
});

describe("blocking a sender", () => {
  it("blocks an anonymous sender by their browser, not their network", async () => {
    expect((await post(`/me/files/${trollClip}/block`, {}, as(alexToken))).status).toBe(200);
    expect(await db.select().from(blocks).get()).toMatchObject({
      ownerId: "usr_a",
      senderKey: await sha256Hex(trollKey),
      contributorUserId: null,
      label: "Troll",
    });

    // Same browser: refused at the pass, before Turnstile is checked.
    const refusedPass = await pass("hop_a", cookieFor(trollKey));
    expect(refusedPass.response.status).toBe(403);
    expect(((await refusedPass.response.json()) as { error: string }).error).toBe("blocked");

    // Someone else on the same network is fine, as is the troll elsewhere.
    const neighbour = await pass("hop_a", cookieFor(randomToken()));
    expect((await upload("hop_a", { withPass: neighbour.pass ?? "" })).status).toBe(201);
    const elsewhere = await pass("hop_b", cookieFor(trollKey));
    expect((await upload("hop_b", { withPass: elsewhere.pass ?? "" })).status).toBe(201);
  });

  it("takes the sender's clips out of the inbox, uploads under way included", async () => {
    const another = await clip("hop_a", "usr_a", {
      senderKey: await sha256Hex(trollKey),
      name: "Troll",
    });
    const underWay = await clip("hop_a", "usr_a", {
      senderKey: await sha256Hex(trollKey),
      name: "Troll",
      status: "pending",
    });
    const someoneElse = await clip("hop_a", "usr_a", { senderKey: await sha256Hex(randomToken()) });

    const response = await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    expect(await response.json()).toEqual({ ok: true, removed: 3 });
    expect(await status(trollClip)).toBe("deleting");
    expect(await status(another)).toBe("deleting");
    expect(await status(underWay)).toBe("deleting");
    expect(await status(someoneElse)).toBe("complete");

    await cleanup(env);
    expect(await status(trollClip)).toBeUndefined();
    expect(await status(someoneElse)).toBe("complete");
  });

  it("holds a reported clip of theirs instead of removing it", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "violence" }, as(alexToken));
    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    expect(await status(trollClip)).toBe("held");
  });

  it("tells Hop's team, once per clip", async () => {
    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    const filed = await db.select().from(reports);
    expect(filed).toEqual([
      expect.objectContaining({
        kind: "block",
        reporterId: "usr_a",
        fileId: trollClip,
        contributorName: "Troll",
      }),
    ]);
    expect(await db.select().from(blocks)).toHaveLength(1);
  });

  it("ends the sender's pass, even if they drop the cookie", async () => {
    const theirs = await pass("hop_a", cookieFor(trollKey));
    // Without the cookie, uploads under the pass still count as theirs.
    expect((await upload("hop_a", { withPass: theirs.pass ?? "" })).status).toBe(201);
    const keys = await db
      .select({ key: files.senderKey })
      .from(files)
      .where(eq(files.status, "pending"));
    expect(keys.map((row) => row.key)).toEqual([await sha256Hex(trollKey)]);

    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    const again = await upload("hop_a", { withPass: theirs.pass ?? "" });
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error: string }).error).toBe("blocked");
  });

  it("blocks a signed-in sender by account and by browser, so signing out doesn't help", async () => {
    const beaKey = randomToken();
    const fileId = await clip("hop_a", "usr_a", {
      userId: "usr_b",
      name: "@bea",
      senderKey: await sha256Hex(beaKey),
    });
    expect((await post(`/me/files/${fileId}/block`, {}, as(alexToken))).status).toBe(200);
    expect(await db.select().from(blocks).get()).toMatchObject({
      contributorUserId: "usr_b",
      senderKey: await sha256Hex(beaKey),
    });
    // Signed in, from any browser.
    expect(
      (await pass("hop_a", { ...as(beaToken), ...cookieFor(randomToken()) })).response.status,
    ).toBe(403);
    // Signed out, from the same browser.
    expect((await pass("hop_a", cookieFor(beaKey))).response.status).toBe(403);
  });

  it("adds what it learns to an existing block of the same sender", async () => {
    // Blocked by browser first, then seen signed in from that browser.
    const beaKey = randomToken();
    const anonymous = await clip("hop_a", "usr_a", {
      senderKey: await sha256Hex(beaKey),
      name: "B",
    });
    await post(`/me/files/${anonymous}/block`, {}, as(alexToken));
    const signedIn = await clip("hop_a", "usr_a", {
      userId: "usr_b",
      name: "@bea",
      senderKey: await sha256Hex(beaKey),
    });
    await post(`/me/files/${signedIn}/block`, {}, as(alexToken));
    expect(await db.select().from(blocks)).toEqual([
      expect.objectContaining({ contributorUserId: "usr_b", senderKey: await sha256Hex(beaKey) }),
    ]);

    // Blocked by account first (a clip from before keys), then seen with one.
    await db.delete(blocks);
    const noKey = await clip("hop_a", "usr_a", { userId: "usr_b", name: "@bea", senderKey: null });
    await post(`/me/files/${noKey}/block`, {}, as(alexToken));
    const otherKey = randomToken();
    const withKey = await clip("hop_a", "usr_a", {
      userId: "usr_b",
      name: "@bea",
      senderKey: await sha256Hex(otherKey),
    });
    await post(`/me/files/${withKey}/block`, {}, as(alexToken));
    expect(await db.select().from(blocks)).toEqual([
      expect.objectContaining({ contributorUserId: "usr_b", senderKey: await sha256Hex(otherKey) }),
    ]);
  });

  it("never blocks the athlete from their own Hop", async () => {
    const own = await clip("hop_a", "usr_a", {
      senderKey: await sha256Hex(trollKey),
      name: "Alex testing",
    });
    await post(`/me/files/${own}/block`, {}, as(alexToken));
    // Signed in, from the browser they tested with: still theirs to use.
    expect(
      (await pass("hop_a", { ...as(alexToken), ...cookieFor(trollKey) })).response.status,
    ).toBe(200);
  });

  it("can't block a sender it can't recognise, or themselves", async () => {
    const old = await clip("hop_a", "usr_a", { senderKey: null });
    const unknown = await post(`/me/files/${old}/block`, {}, as(alexToken));
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as { error: string }).error).toBe("cant_block");
    const own = await clip("hop_a", "usr_a", { userId: "usr_a", name: "@alex" });
    expect((await post(`/me/files/${own}/block`, {}, as(alexToken))).status).toBe(400);
    expect(await db.select().from(blocks)).toEqual([]);
  });

  it("is only for clips sent to them, and rate limited", async () => {
    expect((await post(`/me/files/${trollClip}/block`, {}, as(beaToken))).status).toBe(404);
    allowReports = false;
    expect((await post(`/me/files/${trollClip}/block`, {}, as(alexToken))).status).toBe(429);
    expect(limitedKeys).toEqual(["block:usr_b", "block:usr_a"]);
    expect(await db.select().from(blocks)).toEqual([]);
  });

  it("lists who they blocked, and unblocks them", async () => {
    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    const list = (await (await call("/me/blocks", { headers: as(alexToken) })).json()) as {
      blocks: Block[];
    };
    expect(list.blocks).toEqual([
      { id: expect.stringMatching(/^blk_/), label: "Troll", createdAt: expect.any(Number) },
    ]);
    const id = list.blocks[0]?.id ?? "";

    expect(
      (await call(`/me/blocks/${id}`, { method: "DELETE", headers: as(beaToken) })).status,
    ).toBe(404);
    expect(
      (await call(`/me/blocks/${id}`, { method: "DELETE", headers: as(alexToken) })).status,
    ).toBe(200);
    expect(await db.select().from(blocks)).toEqual([]);
    expect((await pass("hop_a", cookieFor(trollKey))).response.status).toBe(200);
  });

  it("refuses an upload from a sender blocked just as it reserved its place", async () => {
    const theirs = await pass("hop_a", cookieFor(trollKey));
    // The block lands after the upload's first check, as it inserts its row.
    const raw = env.DB;
    let blocked = false;
    const hook = <T extends object>(statement: T): T =>
      new Proxy(statement, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (key === "bind")
            return (...args: unknown[]) =>
              hook((value as (...a: unknown[]) => T).apply(target, args));
          if (key === "run") {
            return async () => {
              if (!blocked) {
                blocked = true;
                await getDb(raw)
                  .insert(blocks)
                  .values({
                    id: "blk_late",
                    ownerId: "usr_a",
                    senderKey: await sha256Hex(trollKey),
                    createdAt: Date.now(),
                  });
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
            return /^\s*insert into "files"/.test(query) ? hook(statement) : statement;
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await upload("hop_a", { withPass: theirs.pass ?? "" });
    expect(blocked).toBe(true);
    expect(response.status).toBe(403);
    expect(await getDb(raw).select().from(files).where(eq(files.status, "pending"))).toEqual([]);
  });
});

describe("the sender key", () => {
  it("is given to a browser without one, named in its pass, and only its hash kept", async () => {
    const { response, pass: given } = await pass("hop_a");
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("hop_sender="));
    expect(cookie).toMatch(
      /^hop_sender=[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=\/api\/hops; HttpOnly; Secure; SameSite=Lax$/,
    );
    const key = cookie?.split(";")[0]?.split("=")[1] ?? "";
    expect((await upload("hop_a", { withPass: given ?? "" })).status).toBe(201);
    const row = await db.select().from(files).where(eq(files.status, "pending")).get();
    expect(row?.senderKey).toBe(await sha256Hex(key));
  });

  it("is kept another year each time it's used", async () => {
    const { response } = await pass("hop_a", cookieFor(trollKey));
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(new RegExp(`^hop_sender=${trollKey}; Max-Age=31536000`)),
    );
  });

  it("comes from the cookie for a pass from before senders were named", async () => {
    expect((await upload("hop_a", { headers: cookieFor(trollKey) })).status).toBe(201);
    const row = await db.select().from(files).where(eq(files.status, "pending")).get();
    expect(row?.senderKey).toBe(await sha256Hex(trollKey));
  });

  it("replaces one that isn't a key", async () => {
    const { response } = await pass("hop_a", cookieFor("not-a-key"));
    expect(
      response.headers.getSetCookie().some((c) => /^hop_sender=[A-Za-z0-9_-]{43};/.test(c)),
    ).toBe(true);
  });
});

describe("reporting a page", () => {
  const report = (handle: string, body: Record<string, unknown> = {}, ip?: string) =>
    post(
      `/h/${handle}/report`,
      { reason: "sexual", note: "Their photo", turnstileToken: "report-token", ...body },
      {},
      ip,
    );

  it("is open to anyone who passes Turnstile", async () => {
    expect((await report("Alex")).status).toBe(200);
    expect(await db.select().from(reports).get()).toMatchObject({
      kind: "profile",
      reason: "sexual",
      reporterId: null,
      subjectUserId: "usr_a",
      reporterIpHash: await sha256Hex("test-secret:203.0.113.7"),
    });
    human = false;
    expect((await report("bea")).status).toBe(403);
    expect((await report("bea", { turnstileToken: undefined })).status).toBe(400);
    expect(await db.select().from(reports)).toHaveLength(1);
  });

  it("counts the same visitor reporting the same page within a day once", async () => {
    await report("alex");
    await report("alex", { reason: "spam" });
    expect(await db.select().from(reports)).toHaveLength(1);
    await db.update(reports).set({ createdAt: Date.now() - DAY - 1 });
    await report("alex");
    expect(await db.select().from(reports)).toHaveLength(2);
  });

  it("is limited per IPv6 /64, not per address", async () => {
    await report("alex", {}, "2001:db8:abcd:12::1");
    await report("bea", {}, "2001:db8:abcd:12:ffff::9");
    expect(limitedKeys[0]).toBe(limitedKeys[1]);
    expect(ipRateKey("2001:db8:abcd:12::1")).toBe("2001:db8:abcd:12::/64");
    expect(ipRateKey("2001:0db8:0000:0012:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:0:12::/64");
    expect(ipRateKey("::1")).toBe("0:0:0:0::/64");
    expect(ipRateKey("203.0.113.7")).toBe("203.0.113.7");
    allowReports = false;
    expect((await report("alex", {}, "2001:db8:abcd:12::77")).status).toBe(429);
  });

  it("is only for pages that exist", async () => {
    expect((await report("nobody")).status).toBe(404);
    await deleteAccount(db, "usr_b");
    expect((await report("bea")).status).toBe(404);
    expect(await db.select().from(reports)).toEqual([]);
  });
});

describe("telling Hop's team", () => {
  it("sends new reports and blocks in one email, then not again", async () => {
    await post(
      `/me/files/${trollClip}/report`,
      { reason: "harassment", note: "<img src=x onerror=alert(1)>" },
      as(alexToken),
    );
    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    await post("/h/bea/report", { reason: "spam", turnstileToken: "report-token" });

    expect(await announceReports(env)).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(["reports@example.com"]);
    expect(sent[0]?.subject).toBe("3 new reports and blocks");
    expect(sent[0]?.text).toContain("@alex reported a clip: Harassment or hate");
    expect(sent[0]?.text).toContain("@alex blocked a sender");
    expect(sent[0]?.text).toContain("A visitor reported onmyhop.com/bea: Spam or scam");
    expect(sent[0]?.text).toContain(`Clip: ${trollClip}`);
    expect(sent[0]?.text).toContain("Note on the clip: look at this");
    expect(sent[0]?.html).not.toContain("<img src=x");
    expect(sent[0]?.key).toMatch(/^reports\/[0-9a-f]{32}$/);

    expect(await announceReports(env)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("tries again next time if the email doesn't go", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "spam" }, as(alexToken));
    resendUp = false;
    await expect(announceReports(env)).rejects.toThrow();
    expect((await db.select().from(reports).get())?.emailedAt).toBeNull();
    resendUp = true;
    expect(await announceReports(env)).toBe(1);
    expect(sent[0]?.subject).toBe("Report: @alex reported a clip: Spam or scam");
  });

  it("runs with the other five-minute email jobs", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "spam" }, as(alexToken));
    await worker.scheduled(
      { cron: "*/5 * * * *", scheduledTime: Date.now() } as ScheduledController,
      env,
      {
        waitUntil: () => {},
      } as unknown as ExecutionContext,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});

describe("reports and blocks over time", () => {
  it("go with the account that made them, keeping what was reported", async () => {
    await post(`/me/files/${trollClip}/report`, { reason: "spam" }, as(alexToken));
    await post(`/me/files/${trollClip}/block`, {}, as(alexToken));
    await post("/h/bea/report", { reason: "spam", turnstileToken: "report-token" });
    await deleteAccount(db, "usr_a");
    expect(await db.select().from(blocks)).toEqual([]);
    const left = await db.select().from(reports);
    expect(left).toHaveLength(3);
    expect(left.every((report) => report.reporterId === null)).toBe(true);
  });

  it("drop a deleted sender's real name, keeping a handle", async () => {
    const fromNora = await clip("hop_a", "usr_a", { userId: "usr_n", name: "Nora Realname" });
    const fromBea = await clip("hop_a", "usr_a", { userId: "usr_b", name: "@bea" });
    await post(`/me/files/${fromNora}/report`, { reason: "spam" }, as(alexToken));
    await post(`/me/files/${fromNora}/block`, {}, as(alexToken));
    await post(`/me/files/${fromBea}/report`, { reason: "spam" }, as(alexToken));
    await deleteAccount(db, "usr_n");
    await deleteAccount(db, "usr_b");
    expect((await db.select().from(blocks).get())?.label).toBeNull();
    const names = await db.select({ name: reports.contributorName }).from(reports);
    expect(names.map((row) => row.name).sort()).toEqual(["@bea", null, null].sort());
  });

  it("keeps reports for a year", async () => {
    await post("/h/bea/report", { reason: "spam", turnstileToken: "report-token" });
    await post("/h/alex/report", { reason: "spam", turnstileToken: "report-token" });
    await db
      .update(reports)
      .set({ createdAt: Date.now() - 366 * DAY })
      .where(and(eq(reports.subjectUserId, "usr_b"), eq(reports.kind, "profile")));
    await cleanup(env);
    const left = await db.select().from(reports);
    expect(left.map((report) => report.subjectUserId)).toEqual(["usr_a"]);
  });
});
