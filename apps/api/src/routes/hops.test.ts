import type { HopActivation, HopArrivals } from "@hop/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../db";
import { files, hops, sessions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { randomToken, sha256Hex } from "../lib/crypto";
import { createTestD1 } from "../test/d1";

const T0 = Date.UTC(2026, 10, 15, 12);
const MIN = 60 * 1000;

let env: Env;
let db: ReturnType<typeof getDb>;
let token: string;

/** An athlete with an app session, a hop of their own, and someone else's. */
beforeEach(async () => {
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
  } as Env;
  db = getDb(DB);
  const now = Date.now();
  await db.insert(users).values([
    { id: "usr_a", oidcSub: "sub-a", handle: "alex", createdAt: now, updatedAt: now },
    { id: "usr_b", oidcSub: "sub-b", handle: "blake", createdAt: now, updatedAt: now },
  ]);
  await db.insert(hops).values([
    { id: "hop_jam", ownerId: "usr_a", slug: "jam", title: "Jam", createdAt: now },
    { id: "hop_other", ownerId: "usr_a", slug: "other", title: "Other", createdAt: now },
    { id: "hop_theirs", ownerId: "usr_b", slug: "theirs", title: "Theirs", createdAt: now },
  ]);
  token = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId: "usr_a",
    kind: "app",
    createdAt: now,
    expiresAt: now + 24 * 60 * MIN,
  });
});

function call(path: string, init: RequestInit = {}) {
  const request = new Request(`https://onmyhop.com/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  return worker.fetch(request, env, {} as ExecutionContext);
}

let fileNumber = 0;
async function clip(
  hopId: string,
  {
    owner = "usr_a",
    createdAt = T0,
    completedAt = T0 as number | null,
    status = "complete" as "pending" | "complete" | "deleting",
    from = "@mia",
  } = {},
) {
  fileNumber += 1;
  const id = `fil_${String(fileNumber).padStart(3, "0")}`;
  await db.insert(files).values({
    id,
    hopId,
    ownerId: owner,
    r2Key: `hops/${hopId}/${id}`,
    originalName: "IMG.MOV",
    mime: "video/quicktime",
    size: 1000,
    partSize: 1000,
    partCount: 1,
    status,
    passId: "pass",
    uploadTokenHash: "x",
    contributorName: from,
    createdAt,
    lastActivityAt: completedAt ?? createdAt,
    completedAt,
  });
  return id;
}

async function arrivals(hopId: string, since: number | string) {
  return call(`/me/hops/${hopId}/arrivals?since=${since}`);
}

describe("activating a hop", () => {
  it("points the link at it and says when, by the server's clock", async () => {
    const before = Date.now();
    const response = await call("/me/hops/hop_jam/activate", { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as HopActivation;
    expect(body.ok).toBe(true);
    expect(body.activatedAt).toBeGreaterThanOrEqual(before);
    expect(body.activatedAt).toBeLessThanOrEqual(Date.now());
    const user = await db.select().from(users).where(eq(users.id, "usr_a")).get();
    expect(user?.activeHopId).toBe("hop_jam");
  });

  it("refuses someone else's hop", async () => {
    const response = await call("/me/hops/hop_theirs/activate", { method: "POST", body: "{}" });
    expect(response.status).toBe(404);
  });
});

describe("arrivals", () => {
  it("counts clips that finished uploading since then, newest first", async () => {
    await clip("hop_jam", { completedAt: T0 - MIN, from: "Before" });
    // Started before, finished after: it arrived after.
    const late = await clip("hop_jam", {
      createdAt: T0 - 5 * MIN,
      completedAt: T0 + MIN,
      from: "Late",
    });
    const newest = await clip("hop_jam", {
      createdAt: T0 + 2 * MIN,
      completedAt: T0 + 3 * MIN,
      from: "Newest",
    });
    await clip("hop_jam", { completedAt: null, status: "pending", from: "Uploading" });
    await clip("hop_jam", { completedAt: T0 + MIN, status: "deleting", from: "Deleting" });
    await clip("hop_other", { completedAt: T0 + MIN, from: "Elsewhere" });

    const response = await arrivals("hop_jam", T0);
    expect(response.status).toBe(200);
    const body = (await response.json()) as HopArrivals;
    expect(body.count).toBe(2);
    expect(body.latest.map((f) => f.id)).toEqual([newest, late]);
    expect(body.latest.map((f) => f.contributorName)).toEqual(["Newest", "Late"]);
  });

  it("counts every arrival but names only the newest ten", async () => {
    for (let i = 0; i < 14; i++)
      await clip("hop_jam", { completedAt: T0 + i * MIN, from: `#${i}` });
    const body = (await (await arrivals("hop_jam", T0)).json()) as HopArrivals;
    expect(body.count).toBe(14);
    expect(body.latest).toHaveLength(10);
    expect(body.latest[0]?.contributorName).toBe("#13");
  });

  it("isn't changed by deleting older clips", async () => {
    const old = await clip("hop_jam", { completedAt: T0 - MIN });
    await clip("hop_jam", { completedAt: T0 + MIN });
    await db.delete(files).where(eq(files.id, old));
    const body = (await (await arrivals("hop_jam", T0)).json()) as HopArrivals;
    expect(body.count).toBe(1);
  });

  it("refuses someone else's hop, and a missing or bad time", async () => {
    await clip("hop_theirs", { owner: "usr_b", completedAt: T0 + MIN });
    expect((await arrivals("hop_theirs", T0)).status).toBe(404);
    expect((await arrivals("hop_gone", T0)).status).toBe(404);
    expect((await call("/me/hops/hop_jam/arrivals")).status).toBe(400);
    expect((await arrivals("hop_jam", "soon")).status).toBe(400);
    expect((await arrivals("hop_jam", -1)).status).toBe(400);
  });

  it("needs a session", async () => {
    token = "hs_nope";
    expect((await arrivals("hop_jam", T0)).status).toBe(401);
  });
});
