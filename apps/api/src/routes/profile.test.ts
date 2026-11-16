import type { Me, PublicHop } from "@hop/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sweepAvatars } from "../cron";
import { getDb } from "../db";
import { hops, sessions, subscriptions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { randomToken, sha256Hex } from "../lib/crypto";
import { createTestD1 } from "../test/d1";
import { createTestR2 } from "../test/r2";

const DAY = 24 * 60 * 60 * 1000;
/** The start of a JPEG, then filler: what the sniffer looks for. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);
const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(200).fill(7),
]);

let env: Env;
let db: ReturnType<typeof getDb>;
let objects: ReturnType<typeof createTestR2>["objects"];
let faults: ReturnType<typeof createTestR2>["faults"];
let token: string;

beforeEach(async () => {
  const DB = createTestD1();
  const r2 = createTestR2();
  objects = r2.objects;
  faults = r2.faults;
  env = {
    DB,
    BUCKET: r2.bucket,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    SESSION_SECRET: "test-secret",
  } as Env;
  db = getDb(DB);
  const now = Date.now();
  await db.insert(users).values({
    id: "usr_a",
    oidcSub: "sub-a",
    name: "Alex Caliplaces",
    handle: "alex",
    activeHopId: "hop_a",
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(hops)
    .values({ id: "hop_a", ownerId: "usr_a", slug: "inbox", title: "Inbox", createdAt: now });
  token = `hs_${randomToken()}`;
  await db.insert(sessions).values({
    id: await sha256Hex(token),
    userId: "usr_a",
    kind: "app",
    createdAt: now,
    expiresAt: now + DAY,
  });
});

function call(path: string, init: RequestInit = {}) {
  return worker.fetch(
    new Request(`https://onmyhop.com/api${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    }),
    env,
    {} as ExecutionContext,
  );
}

const me = async () => ((await (await call("/me")).json()) as { me: Me }).me;
const patch = (body: unknown) =>
  call("/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const upload = (bytes: Uint8Array, type = "image/jpeg") =>
  call("/me/avatar", {
    method: "PUT",
    headers: { "content-type": type, "content-length": String(bytes.byteLength) },
    body: bytes,
  });
const page = async () => (await (await call("/h/alex")).json()) as PublicHop;

describe("the public name", () => {
  it("is their Caliplaces name until they set their own, which sign-ins leave alone", async () => {
    expect((await me()).name).toBe("Alex Caliplaces");

    const response = await patch({ displayName: "  Alex   the Jumper " });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { me: Me }).me.name).toBe("Alex the Jumper");
    expect((await page()).owner.name).toBe("Alex the Jumper");

    // A later sign-in refreshes the Caliplaces name; the Hop one stays.
    await db.update(users).set({ name: "Alex New" }).where(eq(users.id, "usr_a"));
    expect((await me()).name).toBe("Alex the Jumper");

    // Clearing it goes back to the Caliplaces name.
    await patch({ displayName: null });
    expect((await me()).name).toBe("Alex New");
  });

  it("can't be empty, too long, or hide characters", async () => {
    // Written by code point, so no invisible character sits in this file.
    const char = (code: number) => String.fromCodePoint(code);
    for (const displayName of [
      "",
      "   ",
      "x".repeat(51),
      `Alex${char(0x202e)}evil`, // right-to-left override
      `A${char(0x200b)}dmin`, // zero-width space
      `Tab${char(0x7)}bell`, // control character
      char(0x34f), // combining grapheme joiner, invisible on its own
      `Al${char(0x34f)}ex`, // ...and hidden inside a name
      char(0x301), // a lone accent
      `${char(0x34f)} ${char(0x301)}`,
    ]) {
      expect((await patch({ displayName })).status).toBe(400);
    }
    expect((await me()).name).toBe("Alex Caliplaces");
  });

  it("takes any real name: accents, other scripts, emoji", async () => {
    for (const displayName of ["Matěj Matiaško", "李小龍", "Zoë 🏃", "J.R. O'Neil-Smith"]) {
      const response = await patch({ displayName });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { me: Me }).me.name).toBe(displayName);
    }
  });
});

describe("reviewing the profile", () => {
  it("is asked for once, then remembered", async () => {
    expect((await me()).profileReviewed).toBe(false);
    expect((await patch({ profileReviewed: true })).status).toBe(200);
    expect((await me()).profileReviewed).toBe(true);
    expect((await patch({ profileReviewed: false })).status).toBe(400);
  });
});

describe("the profile photo", () => {
  it("is stored under a new random name, served publicly and cached for good", async () => {
    const response = await upload(JPEG);
    expect(response.status).toBe(200);
    const url = ((await response.json()) as { me: Me }).me.avatarUrl ?? "";
    expect(url).toMatch(/^\/api\/avatars\/[A-Za-z0-9_-]{22}\.jpg$/);
    expect((await page()).owner.avatarUrl).toBe(url);

    // Anyone can load it: no session needed.
    const photo = await worker.fetch(
      new Request(`https://onmyhop.com${url}`),
      env,
      {} as ExecutionContext,
    );
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);
  });

  it("replaces the old photo, and can be removed", async () => {
    const first = (await (await upload(JPEG)).json()) as { me: Me };
    const second = (await (await upload(JPEG)).json()) as { me: Me };
    expect(second.me.avatarUrl).not.toBe(first.me.avatarUrl);
    expect(objects.size).toBe(1);

    const removed = (await (
      await call("/me/avatar", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
      })
    ).json()) as { me: Me };
    expect(removed.me.avatarUrl).toBeNull();
    expect(objects.size).toBe(0);
  });

  it("still saves when deleting the old one fails, and the sweep deletes it later", async () => {
    await upload(JPEG);
    faults.deleteFails = true;
    const response = await upload(JPEG);
    expect(response.status).toBe(200);
    expect(objects.size).toBe(2);

    // An hour on, the photo no account points to goes; the one in use stays.
    const removed = await sweepAvatars(env, Date.now() + 2 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    const url = ((await response.json()) as { me: Me }).me.avatarUrl ?? "";
    expect([...objects.keys()]).toEqual([url.replace("/api/", "")]);
  });

  it("isn't swept while it may still be saving", async () => {
    objects.set("avatars/AAAAAAAAAAAAAAAAAAAAAA.jpg", { body: JPEG, uploaded: new Date() });
    expect(await sweepAvatars(env)).toBe(0);
    expect(objects.size).toBe(1);
  });

  it("must be a JPEG of a sensible size", async () => {
    expect((await upload(PNG)).status).toBe(415);
    expect((await upload(JPEG, "image/png")).status).toBe(415);
    const huge = new Uint8Array(600 * 1024);
    huge.set([0xff, 0xd8, 0xff, 0xe0]);
    expect((await upload(huge)).status).toBe(413);
    expect(objects.size).toBe(0);
  });

  it("is only served under names the API makes", async () => {
    // Even where something sits in the bucket under another name.
    objects.set("avatars/x.jpg", { body: JPEG, uploaded: new Date() });
    for (const file of [
      "../secret.jpg",
      "x.jpg",
      "AAAAAAAAAAAAAAAAAAAAAA.png",
      "%2e%2e%2fkey.jpg",
    ]) {
      const response = await worker.fetch(
        new Request(`https://onmyhop.com/api/avatars/${file}`),
        env,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(404);
    }
  });

  it("can't be set without signing in", async () => {
    const response = await worker.fetch(
      new Request("https://onmyhop.com/api/me/avatar", {
        method: "PUT",
        headers: { "content-type": "image/jpeg", "content-length": String(JPEG.byteLength) },
        body: JPEG,
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });
});

describe("the verified badge", () => {
  it("shows while they have Hop+", async () => {
    expect((await me()).verified).toBe(false);
    expect((await page()).owner.verified).toBe(false);
    const now = Date.now();
    await db.insert(subscriptions).values({
      originalTransactionId: "2000000000",
      userId: "usr_a",
      productId: "hop_plus",
      environment: "Production",
      expiresAt: now + DAY,
      purchasedAt: now,
      signedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect((await me()).verified).toBe(true);
    expect((await page()).owner.verified).toBe(true);
  });
});
