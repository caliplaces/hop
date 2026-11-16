import type { Block } from "@hop/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "../cron";
import { getDb } from "../db";
import { blocks, files, hops, reports, sessions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { deleteAccount } from "../lib/accounts";
import { randomToken, sha256Hex, signPayload } from "../lib/crypto";
import { createTestD1 } from "../test/d1";
import { createTestR2 } from "../test/r2";

const DAY = 24 * 60 * 60 * 1000;

let env: Env;
let db: ReturnType<typeof getDb>;
let alexToken: string;
let beaToken: string;
let allowReports: boolean;
let pending: Promise<unknown>[];
let sent: { to: string[]; subject: string; text: string; html: string; key: string | null }[];
/** The browser key of the anonymous sender of fil_anon, and its hash. */
let trollKey: string;

let fileNumber = 0;
async function clip(
  hopId: string,
  owner: string,
  from: { userId?: string; senderKey?: string | null; name?: string } = {},
) {
  fileNumber += 1;
  const id = `fil_${fileNumber}`;
  const now = Date.now();
  await db.insert(files).values({
    id,
    hopId,
    ownerId: owner,
    r2Key: `hops/${hopId}/${id}/original`,
    originalName: "IMG.MOV",
    mime: "video/quicktime",
    size: 1000,
    partSize: 1000,
    partCount: 1,
    status: "complete",
    passId: "pass",
    uploadTokenHash: "x",
    contributorName: from.name ?? "Mia",
    contributorUserId: from.userId ?? null,
    senderKey: from.senderKey ?? null,
    createdAt: now,
    lastActivityAt: now,
    completedAt: now,
  });
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
  const r2 = createTestR2();
  env = {
    DB,
    BUCKET: r2.bucket,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    REPORTS_EMAIL: "reports@example.com",
    REPORT_LIMITER: { limit: async () => ({ success: allowReports }) } as RateLimit,
    UPLOAD_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
  } as Env;
  db = getDb(DB);
  allowReports = true;
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
  ]);
  await db.insert(hops).values([
    { id: "hop_a", ownerId: "usr_a", slug: "inbox", title: "Inbox", createdAt: now },
    { id: "hop_b", ownerId: "usr_b", slug: "inbox", title: "Inbox", createdAt: now },
  ]);
  trollKey = randomToken();
  await clip("hop_a", "usr_a", { senderKey: await sha256Hex(trollKey), name: "Troll" }); // fil_N
  alexToken = await session("usr_a");
  beaToken = await session("usr_b");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        ...init.headers,
      },
    }),
    env,
    {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  );
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers });
const anonClip = async () =>
  (await db.select().from(files).where(eq(files.contributorName, "Troll")).get())?.id ?? "";

/** Starts an upload into a hop, as a sender with this browser key (or none yet). */
async function upload(
  hopId: string,
  { key, headers = {} }: { key?: string; headers?: Record<string, string> } = {},
) {
  const pass = await signPayload(env.SESSION_SECRET, {
    purpose: "hop-pass",
    exp: Date.now() + DAY,
    hopId,
    passId: randomToken(12),
  });
  return call(`/hops/${hopId}/uploads`, {
    method: "POST",
    body: JSON.stringify({ name: "IMG.MOV", size: 5_000_000, type: "video/quicktime" }),
    headers: {
      "x-hop-pass": pass,
      ...(key ? { cookie: `hop_sender=${key}` } : {}),
      ...headers,
    },
  });
}

describe("reporting a clip", () => {
  it("records it and tells Hop's team", async () => {
    const fileId = await anonClip();
    const response = await post(
      `/me/files/${fileId}/report`,
      { reason: "harassment", note: "Keeps sending this" },
      as(alexToken),
    );
    expect(response.status).toBe(200);

    const report = await db.select().from(reports).get();
    expect(report).toMatchObject({
      kind: "clip",
      reason: "harassment",
      note: "Keeps sending this",
      reporterId: "usr_a",
      fileId,
      contributorName: "Troll",
      senderKey: await sha256Hex(trollKey),
      subjectUserId: null,
    });

    await Promise.all(pending);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(["reports@example.com"]);
    expect(sent[0]?.subject).toBe("Report: a clip (Harassment or hate)");
    expect(sent[0]?.key).toBe(`report/${report?.id}`);
    expect(sent[0]?.text).toContain("A clip sent to @alex was reported by them.");
    expect(sent[0]?.text).toContain(`Clip: ${fileId}`);
    expect(sent[0]?.text).toContain("Keeps sending this");
  });

  it("names the account when the sender was signed in", async () => {
    const fileId = await clip("hop_a", "usr_a", { userId: "usr_b", name: "@bea" });
    await post(`/me/files/${fileId}/report`, { reason: "spam" }, as(alexToken));
    expect((await db.select().from(reports).get())?.subjectUserId).toBe("usr_b");
  });

  it("escapes what they wrote", async () => {
    await post(
      `/me/files/${await anonClip()}/report`,
      { reason: "other", note: '<img src=x onerror="alert(1)">' },
      as(alexToken),
    );
    await Promise.all(pending);
    expect(sent[0]?.html).not.toContain("<img src=x");
    expect(sent[0]?.html).toContain("&lt;img src=x");
  });

  it("is only for clips sent to them", async () => {
    const response = await post(
      `/me/files/${await anonClip()}/report`,
      { reason: "spam" },
      as(beaToken),
    );
    expect(response.status).toBe(404);
    expect(await db.select().from(reports)).toEqual([]);
  });

  it("needs a reason from the list, and a short note", async () => {
    const fileId = await anonClip();
    expect(
      (await post(`/me/files/${fileId}/report`, { reason: "boring" }, as(alexToken))).status,
    ).toBe(400);
    const long = { reason: "other", note: "x".repeat(501) };
    expect((await post(`/me/files/${fileId}/report`, long, as(alexToken))).status).toBe(400);
    expect(await db.select().from(reports)).toEqual([]);
  });

  it("needs a signed-in athlete, and is rate limited", async () => {
    const fileId = await anonClip();
    expect((await post(`/me/files/${fileId}/report`, { reason: "spam" })).status).toBe(401);
    allowReports = false;
    expect(
      (await post(`/me/files/${fileId}/report`, { reason: "spam" }, as(alexToken))).status,
    ).toBe(429);
    expect(await db.select().from(reports)).toEqual([]);
  });
});

describe("blocking a sender", () => {
  it("blocks an anonymous sender by their browser, not their network", async () => {
    expect((await post(`/me/files/${await anonClip()}/block`, {}, as(alexToken))).status).toBe(200);
    expect(await db.select().from(blocks).get()).toMatchObject({
      ownerId: "usr_a",
      senderKey: await sha256Hex(trollKey),
      contributorUserId: null,
      label: "Troll",
    });

    // Same network, same browser: refused, before the challenge and at upload.
    const passResponse = await post(
      "/hops/hop_a/pass",
      { turnstileToken: "t" },
      { cookie: `hop_sender=${trollKey}` },
    );
    expect(passResponse.status).toBe(403);
    expect(((await passResponse.json()) as { error: string }).error).toBe("blocked");
    const refused = await upload("hop_a", { key: trollKey });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("blocked");

    // Someone else on the same network is fine, as is the troll elsewhere.
    expect((await upload("hop_a", { key: randomToken() })).status).toBe(201);
    expect((await upload("hop_b", { key: trollKey })).status).toBe(201);
  });

  it("blocks a signed-in sender by account, whatever browser they use", async () => {
    const fileId = await clip("hop_a", "usr_a", { userId: "usr_b", name: "@bea" });
    expect((await post(`/me/files/${fileId}/block`, {}, as(alexToken))).status).toBe(200);
    expect(await db.select().from(blocks).get()).toMatchObject({
      contributorUserId: "usr_b",
      senderKey: null,
    });
    const refused = await upload("hop_a", { key: randomToken(), headers: as(beaToken) });
    expect(refused.status).toBe(403);
    // Signed out, she's a stranger again.
    expect((await upload("hop_a", { key: randomToken() })).status).toBe(201);
  });

  it("counts blocking twice as once", async () => {
    const fileId = await anonClip();
    await post(`/me/files/${fileId}/block`, {}, as(alexToken));
    expect((await post(`/me/files/${fileId}/block`, {}, as(alexToken))).status).toBe(200);
    expect(await db.select().from(blocks)).toHaveLength(1);
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

  it("is only for clips sent to them", async () => {
    expect((await post(`/me/files/${await anonClip()}/block`, {}, as(beaToken))).status).toBe(404);
    expect(await db.select().from(blocks)).toEqual([]);
  });

  it("lists who they blocked, and unblocks them", async () => {
    await post(`/me/files/${await anonClip()}/block`, {}, as(alexToken));
    const list = (await (await call("/me/blocks", { headers: as(alexToken) })).json()) as {
      blocks: Block[];
    };
    expect(list.blocks).toEqual([
      { id: expect.stringMatching(/^blk_/), label: "Troll", createdAt: expect.any(Number) },
    ]);
    const id = list.blocks[0]?.id ?? "";

    // Not someone else's.
    expect(
      (await call(`/me/blocks/${id}`, { method: "DELETE", headers: as(beaToken) })).status,
    ).toBe(404);
    expect(
      (await call(`/me/blocks/${id}`, { method: "DELETE", headers: as(alexToken) })).status,
    ).toBe(200);
    expect(await db.select().from(blocks)).toEqual([]);
    expect((await upload("hop_a", { key: trollKey })).status).toBe(201);
  });

  it("refuses an upload from a sender blocked just as it reserved its place", async () => {
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
    const response = await upload("hop_a", { key: trollKey });
    expect(blocked).toBe(true);
    expect(response.status).toBe(403);
    expect(await getDb(raw).select().from(files).where(eq(files.status, "pending"))).toEqual([]);
  });
});

describe("the sender key", () => {
  it("is given to a browser without one, and only its hash is kept", async () => {
    const response = await upload("hop_a");
    expect(response.status).toBe(201);
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("hop_sender="));
    expect(cookie).toMatch(
      /^hop_sender=[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=\/api\/hops; HttpOnly; Secure; SameSite=Lax$/,
    );
    const key = cookie?.split(";")[0]?.split("=")[1] ?? "";
    const row = await db.select().from(files).where(eq(files.status, "pending")).get();
    expect(row?.senderKey).toBe(await sha256Hex(key));
  });

  it("is kept by a browser that has one", async () => {
    const response = await upload("hop_a", { key: trollKey });
    expect(response.headers.getSetCookie().some((c) => c.startsWith("hop_sender="))).toBe(false);
    const row = await db.select().from(files).where(eq(files.status, "pending")).get();
    expect(row?.senderKey).toBe(await sha256Hex(trollKey));
  });

  it("replaces one that isn't a key", async () => {
    const response = await upload("hop_a", { key: "not-a-key" });
    expect(response.headers.getSetCookie().some((c) => c.startsWith("hop_sender="))).toBe(true);
  });
});

describe("reporting a page", () => {
  it("is open to anyone, and tells Hop's team", async () => {
    const response = await post("/h/Alex/report", { reason: "sexual", note: "Their photo" });
    expect(response.status).toBe(200);
    const report = await db.select().from(reports).get();
    expect(report).toMatchObject({
      kind: "profile",
      reason: "sexual",
      reporterId: null,
      subjectUserId: "usr_a",
      reporterIpHash: await sha256Hex("test-secret:203.0.113.7"),
    });
    await Promise.all(pending);
    expect(sent[0]?.subject).toBe("Report: onmyhop.com/alex (Sexual content)");
  });

  it("is only for pages that exist", async () => {
    expect((await post("/h/nobody/report", { reason: "spam" })).status).toBe(404);
    await deleteAccount(db, "usr_b");
    expect((await post("/h/bea/report", { reason: "spam" })).status).toBe(404);
    expect(await db.select().from(reports)).toEqual([]);
  });

  it("is rate limited", async () => {
    allowReports = false;
    expect((await post("/h/alex/report", { reason: "spam" })).status).toBe(429);
  });
});

describe("reports and blocks over time", () => {
  it("go with the account that made them, keeping what was reported", async () => {
    await post(`/me/files/${await anonClip()}/report`, { reason: "spam" }, as(alexToken));
    await post(`/me/files/${await anonClip()}/block`, {}, as(alexToken));
    await post("/h/bea/report", { reason: "spam" });
    await deleteAccount(db, "usr_a");
    expect(await db.select().from(blocks)).toEqual([]);
    const left = await db.select().from(reports);
    expect(left).toHaveLength(2);
    expect(left.every((report) => report.reporterId === null)).toBe(true);
  });

  it("keeps reports for a year", async () => {
    await post("/h/bea/report", { reason: "spam" });
    await post("/h/alex/report", { reason: "spam" });
    await db
      .update(reports)
      .set({ createdAt: Date.now() - 366 * DAY })
      .where(eq(reports.subjectUserId, "usr_b"));
    await cleanup(env);
    const left = await db.select().from(reports);
    expect(left.map((report) => report.subjectUserId)).toEqual(["usr_a"]);
  });
});
