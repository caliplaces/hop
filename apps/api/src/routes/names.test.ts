import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { hops, sessions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { randomToken, sha256Hex } from "../lib/crypto";
import { createTestD1 } from "../test/d1";

const DAY = 24 * 60 * 60 * 1000;

let env: Env;
let db: ReturnType<typeof getDb>;
/** Alex has a handle and an event; Cleo hasn't claimed one yet. */
let alex: string;
let cleo: string;

async function session(userId: string) {
  const token = `hs_${randomToken()}`;
  const now = Date.now();
  await db
    .insert(sessions)
    .values({
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
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
  } as Env;
  db = getDb(DB);
  // The welcome email is printed without a Resend key.
  vi.spyOn(console, "log").mockImplementation(() => {});
  const now = Date.now();
  await db.insert(users).values([
    { id: "usr_a", oidcSub: "sub-a", handle: "alex", createdAt: now, updatedAt: now },
    { id: "usr_c", oidcSub: "sub-c", createdAt: now, updatedAt: now },
  ]);
  await db
    .insert(hops)
    .values({ id: "hop_jam", ownerId: "usr_a", slug: "jam", title: "Jam", createdAt: now });
  alex = await session("usr_a");
  cleo = await session("usr_c");
});

function call(path: string, token: string | null, init: RequestInit = {}) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
  );
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

describe("handles with a word Hop doesn't allow", () => {
  it("are shown as unavailable, without saying why", async () => {
    const reply = await (await call("/handles/b1g_a55", null)).json();
    expect(reply).toEqual({ handle: "b1g_a55", available: false, problem: "unavailable" });
    const fine = await (await call("/handles/classic.rider", null)).json();
    expect(fine).toMatchObject({ available: true, problem: null });
  });

  it("can't be claimed", async () => {
    const claim = await call("/me/handle", cleo, {
      method: "PUT",
      ...json({ handle: "Sh1t.Happens" }),
    });
    expect(claim.status).toBe(400);
    expect(await claim.json()).toEqual({
      error: "handle_unavailable",
      message: "That handle isn't available.",
    });
    const row = await db.select().from(users).where(eq(users.id, "usr_c")).get();
    expect(row?.handle).toBeNull();
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_c"))).toEqual([]);

    const fine = await call("/me/handle", cleo, { method: "PUT", ...json({ handle: "cockburn" }) });
    expect(fine.status).toBe(200);
  });
});

describe("events with a word Hop doesn't allow", () => {
  const create = (body: unknown) => call("/me/hops", alex, { method: "POST", ...json(body) });

  it("can't be made, whether it's in the name or the link", async () => {
    for (const body of [
      { title: "Big Ass Jam" },
      { title: "Worlds", slug: "p0rn-party" },
      { title: "Fuck yeah", slug: "worlds" },
    ]) {
      const response = await create(body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("name_unavailable");
    }
    expect(await db.select().from(hops).where(eq(hops.ownerId, "usr_a"))).toHaveLength(1);
    expect((await create({ title: "Sussex Open" })).status).toBe(201);
  });

  it("can't be renamed to one", async () => {
    const rename = (title: string) =>
      call("/me/hops/hop_jam", alex, { method: "PATCH", ...json({ title }) });
    const response = await rename("Sh!t show");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("name_unavailable");
    expect((await db.select().from(hops).where(eq(hops.id, "hop_jam")).get())?.title).toBe("Jam");
    expect((await rename("Classic jam")).status).toBe(200);
    // Closing an event never needs its name checked.
    const close = await call("/me/hops/hop_jam", alex, {
      method: "PATCH",
      ...json({ status: "closed" }),
    });
    expect(close.status).toBe(200);
  });
});
