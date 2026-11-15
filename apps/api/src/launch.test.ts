import { LAUNCH_AT } from "@hop/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "./cron";
import { getDb } from "./db";
import { waitlist } from "./db/schema";
import { launchEmail } from "./email/launch";
import { setResendPacing } from "./email/send";
import type { Env } from "./env";
import { sendEmails } from "./index";
import { announceLaunch, launchAt } from "./launch";
import { sha256Hex } from "./lib/crypto";
import { createTestD1 } from "./test/d1";

const DAY = 24 * 60 * 60 * 1000;
let env: Env;
let db: ReturnType<typeof getDb>;
/** What Resend was asked to send: to whom, with which key. */
let sends: { to: string; key: string | null; subject: string }[];
/** Resend's answer for an address; 200 unless a test says otherwise. */
let answer: (to: string) => number;

const run = (options: Parameters<typeof announceLaunch>[1] = {}) =>
  announceLaunch(env, { now: LAUNCH_AT, ...options });

async function join(...addresses: string[]) {
  let at = Date.now() - DAY;
  for (const email of addresses) {
    await db.insert(waitlist).values({ email, createdAt: at++ });
  }
}

const row = async (email: string) =>
  db.select().from(waitlist).where(eq(waitlist.email, email)).get();

beforeEach(() => {
  env = {
    DB: createTestD1(),
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    RESEND_API_KEY: "re_test",
  } as Env;
  db = getDb(env.DB);
  sends = [];
  answer = () => 200;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
    const to = body.to[0] ?? "";
    sends.push({
      to,
      key: new Headers(init?.headers).get("idempotency-key"),
      subject: body.subject,
    });
    const status = answer(to);
    return status === 200
      ? Response.json({ id: "email_1" })
      : Response.json(
          { name: status === 409 ? "invalid_idempotent_request" : "error", message: "nope" },
          { status },
        );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the launch email", () => {
  it("waits for the launch", async () => {
    await join("maya@example.com");
    await run({ now: LAUNCH_AT - 1 });
    expect(sends).toHaveLength(0);
  });

  it("goes to everyone on the waitlist once, from the launch on", async () => {
    await join("maya@example.com", "leo@example.com", "ana@example.com");
    await run();
    expect(sends.map((send) => send.to)).toEqual([
      "maya@example.com",
      "leo@example.com",
      "ana@example.com",
    ]);
    expect(sends[0]?.key).toBe(`launch/${await sha256Hex("maya@example.com")}`);
    expect(sends[0]?.subject).toBe("Hop is live: get your link");
    expect((await row("maya@example.com"))?.notifiedAt).toBeTypeOf("number");

    // Later runs have nothing left to send.
    await run({ now: LAUNCH_AT + DAY });
    expect(sends).toHaveLength(3);
  });

  it("never sends one twice, even with runs overlapping", async () => {
    await join(...Array.from({ length: 30 }, (_, i) => `athlete${i}@example.com`));
    await Promise.all([run(), run()]);
    expect(sends).toHaveLength(30);
    expect(new Set(sends.map((send) => send.to)).size).toBe(30);
  });

  it("tries a failed one again later, with the same key, five times at most", async () => {
    await join("maya@example.com", "leo@example.com");
    answer = (to) => (to === "leo@example.com" ? 500 : 200);
    await run();
    expect(sends.map((send) => send.to)).toEqual(["maya@example.com", "leo@example.com"]);

    // Not straight away...
    await run();
    expect(sends).toHaveLength(2);

    // ...but once a few minutes have passed, with the key it had.
    for (let attempt = 2; attempt <= 6; attempt++) {
      await db
        .update(waitlist)
        .set({ launchAttemptedAt: Date.now() - 6 * 60 * 1000 })
        .where(eq(waitlist.email, "leo@example.com"));
      await run();
    }
    const leo = sends.filter((send) => send.to === "leo@example.com");
    expect(leo).toHaveLength(5);
    expect(new Set(leo.map((send) => send.key)).size).toBe(1);
    expect((await row("leo@example.com"))?.notifiedAt).toBeNull();
  });

  it("stops the run when Resend says to slow down", async () => {
    await join("maya@example.com", "leo@example.com", "ana@example.com");
    answer = () => 429;
    await run();
    expect(sends).toHaveLength(1);
    expect((await row("leo@example.com"))?.launchAttempts).toBe(0);
  });

  it("keeps to its time", async () => {
    await join("maya@example.com");
    await run({ budgetMs: 0 });
    expect(sends).toHaveLength(0);
  });

  it("stops trying before the key that keeps it from going twice could expire", async () => {
    await join("maya@example.com");
    // First tried almost a day ago, and never confirmed.
    await db
      .update(waitlist)
      .set({
        launchFirstAttemptAt: Date.now() - 23.5 * 60 * 60 * 1000,
        launchAttemptedAt: Date.now() - 60 * 60 * 1000,
        launchAttempts: 1,
      })
      .where(eq(waitlist.email, "maya@example.com"));
    await run();
    expect(sends).toHaveLength(0);
  });

  it("counts it as sent when Resend already had a different email under its key", async () => {
    await join("maya@example.com");
    answer = () => 409;
    await run();
    expect(sends).toHaveLength(1);
    expect((await row("maya@example.com"))?.notifiedAt).toBeTypeOf("number");
  });

  it("can go out early where LAUNCH_AT says, to try it on staging", async () => {
    env.LAUNCH_AT = "2026-11-20T10:00:00Z";
    expect(launchAt(env)).toBe(Date.parse("2026-11-20T10:00:00Z"));
    await join("maya@example.com");
    await run({ now: Date.parse("2026-11-20T10:05:00Z") });
    expect(sends).toHaveLength(1);

    env.LAUNCH_AT = "not a date";
    expect(launchAt(env)).toBe(LAUNCH_AT);
  });

  it("leaves the waitlist a day after it went out", async () => {
    await join("maya@example.com", "leo@example.com", "ana@example.com");
    await db
      .update(waitlist)
      .set({ notifiedAt: Date.now() - 2 * DAY })
      .where(eq(waitlist.email, "maya@example.com"));
    await db
      .update(waitlist)
      .set({ notifiedAt: Date.now() - 60 * 60 * 1000 })
      .where(eq(waitlist.email, "leo@example.com"));
    await cleanup(env);
    const left = (await db.select().from(waitlist)).map((entry) => entry.email).sort();
    expect(left).toEqual(["ana@example.com", "leo@example.com"]);
  });

  it("leaves the waitlist a week after the first try if it never got through", async () => {
    await join("maya@example.com", "leo@example.com", "ana@example.com");
    const tried = (email: string, days: number) =>
      db
        .update(waitlist)
        .set({ launchFirstAttemptAt: Date.now() - days * DAY, launchAttempts: 5 })
        .where(eq(waitlist.email, email));
    await tried("maya@example.com", 8);
    await tried("leo@example.com", 2);
    await cleanup(env);
    const left = (await db.select().from(waitlist)).map((entry) => entry.email).sort();
    expect(left).toEqual(["ana@example.com", "leo@example.com"]);
  });
});

describe("its content", () => {
  it("says how to start, and links the app once it's out", async () => {
    const plain = await launchEmail({ appUrl: "https://onmyhop.com" });
    expect(plain.html).toContain('href="https://onmyhop.com/app"');
    expect(plain.html).toContain("cheer-grape.png");
    expect(plain.text).toContain("Get your Hop: https://onmyhop.com/app");
    expect(plain.text).toContain("the only email the waitlist sends");
    expect(plain.text).not.toContain("App Store");
    expect(plain.html).not.toContain("apps.apple.com");

    const withApp = await launchEmail({
      appUrl: "https://onmyhop.com",
      appStoreUrl: "https://apps.apple.com/app/id6834920854",
    });
    expect(withApp.html).toContain('href="https://apps.apple.com/app/id6834920854"');
    expect(withApp.text).toContain(
      "On iPhone? Get the app: https://apps.apple.com/app/id6834920854",
    );
  });
});

describe("sending pace", () => {
  afterEach(() => setResendPacing(0));

  it("spaces every send to Resend, whichever job it's from", async () => {
    setResendPacing(40);
    await join("maya@example.com", "leo@example.com", "ana@example.com");
    const started = Date.now();
    await run();
    expect(sends).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });
});

describe("the five-minute email jobs", () => {
  it("log a failed job and fail the run, after letting the other finish", async () => {
    await join("maya@example.com");
    // The digest's first query fails; the launch email still goes out.
    const failing = {
      ...env,
      DB: new Proxy(env.DB, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (key !== "prepare") return typeof value === "function" ? value.bind(target) : value;
          return (query: string) => {
            if (query.includes("notify_attempted_at")) throw new Error("D1 is down");
            return target.prepare(query);
          };
        },
      }),
    } as Env;
    vi.setSystemTime(LAUNCH_AT + 60_000);
    try {
      await expect(sendEmails(failing)).rejects.toThrow("email jobs failed: digest");
    } finally {
      vi.useRealTimers();
    }
    expect(sends.map((send) => send.to)).toEqual(["maya@example.com"]);
    expect(console.error).toHaveBeenCalledWith("digest: run failed", expect.any(Error));
  });
});
