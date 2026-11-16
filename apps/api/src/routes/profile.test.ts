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
import { BASELINE_JPEG } from "../test/jpegs";
import { createTestR2 } from "../test/r2";

const DAY = 24 * 60 * 60 * 1000;
/** A real (tiny) JPEG: the server rebuilds photos, so a bare signature won't do. */
const JPEG = BASELINE_JPEG;
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
let allowChanges: boolean;

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
    PROFILE_LIMITER: { limit: async () => ({ success: allowChanges }) } as RateLimit,
  } as Env;
  allowChanges = true;
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
      "@simone", // passes for a handle
      `Simone ${char(0x2713)}`, // a check mark passes for a badge
      `Simone ${char(0x2705)}`,
      `A${char(0x301).repeat(8)}`, // stacked marks
      char(0x2800).repeat(3), // braille blanks: nothing readable
      char(0x3164), // a Hangul filler
    ]) {
      expect((await patch({ displayName })).status).toBe(400);
    }
    expect((await me()).name).toBe("Alex Caliplaces");
  });

  it("takes any real name: accents, other scripts, emoji", async () => {
    const char = (code: number) => String.fromCodePoint(code);
    // Woman running: an emoji built with a zero-width joiner, which is fine there.
    const runner = `${char(0x1f3c3)}${char(0x200d)}${char(0x2640)}${char(0xfe0f)}`;
    for (const displayName of [
      "Matěj Matiaško",
      "李小龍",
      "Zoë 🏃",
      "J.R. O'Neil-Smith",
      `Mia ${runner}`,
    ]) {
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

describe("notification settings", () => {
  it("announce new clips by email and on the phone until turned off, each on its own", async () => {
    expect(await me()).toMatchObject({ emailNewClips: true, pushNewClips: true });
    expect((await patch({ pushNewClips: false })).status).toBe(200);
    expect(await me()).toMatchObject({ emailNewClips: true, pushNewClips: false });
    await patch({ emailNewClips: false, pushNewClips: true });
    expect(await me()).toMatchObject({ emailNewClips: false, pushNewClips: true });
    expect((await patch({ pushNewClips: "no" })).status).toBe(400);
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

  it("is served without its location or anything hidden in it", async () => {
    const exif = new TextEncoder().encode("Exif\0\0GPSLatitude 50.0755 GPSLongitude 14.4378");
    const length = exif.length + 2;
    const tagged = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      length >> 8,
      length & 0xff,
      ...exif,
      ...JPEG.subarray(2),
      ...new TextEncoder().encode("<html>hosted here</html>"),
    ]);
    const response = await upload(tagged);
    expect(response.status).toBe(200);
    const [stored] = [...objects.values()];
    expect(stored?.body).toEqual(JPEG);
  });

  it("is refused when it's a JPEG's first bytes and something else", async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode("<html></html>")]);
    expect((await upload(fake)).status).toBe(415);
    expect(objects.size).toBe(0);
  });

  it("only ever deletes photos, whatever the stored key says", async () => {
    const clip = "hops/hop_a/clip.mp4";
    objects.set(clip, { body: JPEG, uploaded: new Date() });
    await db.update(users).set({ avatarKey: clip }).where(eq(users.id, "usr_a"));
    expect((await upload(JPEG)).status).toBe(200);
    expect(objects.has(clip)).toBe(true);
  });

  it("can't be changed over and over", async () => {
    allowChanges = false;
    expect((await upload(JPEG)).status).toBe(429);
    expect((await patch({ displayName: "Alex" })).status).toBe(429);
    expect(objects.size).toBe(0);
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

describe("the Hop+ mark", () => {
  it("shows while they have Hop+", async () => {
    expect((await me()).hopPlus).toBe(false);
    expect((await page()).owner.hopPlus).toBe(false);
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
    expect((await me()).hopPlus).toBe(true);
    expect((await page()).owner.hopPlus).toBe(true);
  });
});
