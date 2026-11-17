import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { emailSuppressions, undeliveredEmails, users } from "../db/schema";
import type { Env } from "../env";
import { letGoUndelivered } from "../expiry";
import worker from "../index";
import { deleteAccount } from "../lib/accounts";
import { createTestD1 } from "../test/d1";
import { emailEvent, signature, svixHeaders, WEBHOOK_SECRET } from "../test/svix";
import { accountDeletedEmail, sendAccountDeletedEmail } from "./account-deleted";
import { sendEmail } from "./send";
import {
  forgetOldSuppressions,
  isSuppressed,
  KEEP_SUPPRESSIONS_MS,
  KEEP_UNDELIVERED_MS,
  normalizeAddress,
  suppress,
} from "./suppressions";
import { equalBytes, readResendEvent, verifyResendWebhook } from "./webhook";
import { sendWelcomeEmail } from "./welcome";

let env: Env;
let db: ReturnType<typeof getDb>;
let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as Env;
  db = getDb(DB);
  fetch = vi.fn(async () => Response.json({ id: "email_1" }));
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function hook(
  event: unknown,
  headers?: (body: string) => Promise<Record<string, string>>,
  raw?: string,
) {
  const body = raw ?? JSON.stringify(event);
  return worker.fetch(
    new Request("https://onmyhop.com/api/email/resend-webhook", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...(await (headers ?? svixHeaders)(body)),
      },
    }),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
  );
}

const reasons = async () =>
  Object.fromEntries(
    (await db.select().from(emailSuppressions)).map((row) => [row.email, row.reason]),
  );

const bounce = (type: string, data: Record<string, unknown> = {}) =>
  emailEvent("email.bounced", {
    bounce: { type, subType: "General", message: "550 5.1.1 The email account does not exist." },
    ...data,
  });

describe("Resend's webhook", () => {
  it("stops emailing an address that bounced for good, however it's written", async () => {
    const response = await hook(bounce("Permanent", { to: ["  Alex@Example.com "] }));
    expect(response.status).toBe(200);
    expect(await reasons()).toEqual({ "alex@example.com": "bounced" });
    expect(await isSuppressed(db, "ALEX@example.com")).toBe(true);
  });

  it("leaves an address alone after a bounce that may not last", async () => {
    for (const type of ["Temporary", "Transient", "Undetermined", ""]) {
      expect((await hook(bounce(type))).status).toBe(200);
    }
    expect((await hook(emailEvent("email.bounced"))).status).toBe(200);
    expect(await reasons()).toEqual({});
  });

  it("stops emailing someone who reported Hop's email as spam", async () => {
    await hook(emailEvent("email.complained"));
    expect(await reasons()).toEqual({ "alex@example.com": "complained" });
  });

  it("stops emailing an address Resend won't send to", async () => {
    await hook(
      emailEvent("email.suppressed", {
        suppressed: { type: "OnAccountSuppressionList", message: "On the suppression list" },
      }),
    );
    expect(await reasons()).toEqual({ "alex@example.com": "suppressed" });
  });

  it("answers every other event, and other products' emails, without acting on them", async () => {
    for (const type of ["email.delivered", "email.sent", "email.failed", "contact.created"]) {
      expect((await hook(emailEvent(type))).status).toBe(200);
    }
    // The Resend account sends for other products too.
    const theirs = bounce("Permanent");
    theirs.data.from = "Backloo <hi@backloo.com>";
    expect((await hook(theirs)).status).toBe(200);
    expect(
      (await hook(emailEvent("email.complained", {}, "hello@onmyhop.com.evil.example"))).status,
    ).toBe(200);
    expect(await reasons()).toEqual({});
  });

  it("reads every address it names, once each, and nothing that isn't one", async () => {
    await hook(
      bounce("Permanent", {
        to: [
          "Cleo <cleo@example.com>",
          "ALEX@example.com",
          "alex@example.com",
          "not an address",
          7,
        ],
      }),
    );
    expect(await reasons()).toEqual({
      "alex@example.com": "bounced",
      "cleo@example.com": "bounced",
    });
  });

  it("keeps the reason an address was first added for, however often it's told", async () => {
    await hook(emailEvent("email.complained"));
    await hook(bounce("Permanent"));
    await hook(bounce("Permanent"));
    expect(await reasons()).toEqual({ "alex@example.com": "complained" });
  });

  it("is refused unless Resend signed it, recently, with this endpoint's secret", async () => {
    const event = bounce("Permanent");
    const now = Math.floor(Date.now() / 1000);
    const other = `whsec_${btoa("another endpoint's secret")}`;
    const refused = [
      await hook(event, (body) => svixHeaders(body, { secret: other })),
      await hook(event, (body) => svixHeaders(body, { timestamp: now - 6 * 60 })),
      await hook(event, (body) => svixHeaders(body, { timestamp: now + 6 * 60 })),
      await hook(event, (body) => svixHeaders(`${body} `)),
      await hook(event, async (body) => ({
        ...(await svixHeaders(body)),
        "svix-id": "msg_2",
      })),
      await hook(event, async (body) => {
        const headers = await svixHeaders(body);
        return {
          ...headers,
          "svix-signature": (headers["svix-signature"] ?? "").replace("v1,", "v2,"),
        };
      }),
      await hook(event, async (body) => ({ ...(await svixHeaders(body)), "svix-signature": "" })),
      await hook(event, async () => ({})),
    ];
    expect(refused.map((response) => response.status)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400,
    ]);
    expect(await reasons()).toEqual({});

    // While the secret is being rolled, Resend signs with both.
    const both = await hook(event, async (body) => {
      const headers = await svixHeaders(body);
      const old = await signature(body, { secret: other, timestamp: now });
      return { ...headers, "svix-signature": `${old} ${headers["svix-signature"]}` };
    });
    expect(both.status).toBe(200);
    expect(await reasons()).toEqual({ "alex@example.com": "bounced" });
  });

  it("isn't there without its secret", async () => {
    env = { ...env, RESEND_WEBHOOK_SECRET: undefined };
    expect((await hook(bounce("Permanent"))).status).toBe(404);
    expect(await reasons()).toEqual({});
  });

  it("refuses a signed body that isn't JSON, and a huge one", async () => {
    expect((await hook(null, undefined, "not json")).status).toBe(400);
    expect((await hook(null, undefined, "x".repeat(300 * 1024))).status).toBe(413);
  });
});

describe("the signature check", () => {
  it("agrees with Svix's published example", async () => {
    // From Svix's docs on verifying webhooks by hand.
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const body = new TextEncoder().encode('{"test": 2432232314}');
    const headers = {
      id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
      timestamp: "1614265330",
      signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    };
    expect(await verifyResendWebhook(secret, headers, body, 1614265330 * 1000)).toBe(true);
    expect(await verifyResendWebhook(secret, headers, body, (1614265330 + 301) * 1000)).toBe(false);
    expect(
      await verifyResendWebhook(
        secret,
        { ...headers, timestamp: "1614265331" },
        body,
        1614265330 * 1000,
      ),
    ).toBe(false);
    expect(
      await verifyResendWebhook(secret.replace("whsec_", ""), headers, body, 1614265330 * 1000),
    ).toBe(false);
    // Only a secret in Svix's own format.
    expect(
      await verifyResendWebhook(
        secret.replace("whsec_", "secret"),
        headers,
        body,
        1614265330 * 1000,
      ),
    ).toBe(false);
  });

  it("reads only the first few signatures, so a forged header can't make much work", async () => {
    const event = bounce("Permanent");
    const forged = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    // The real signature, behind `count` forged ones.
    const behind = (count: number) => async (body: string) => {
      const headers = await svixHeaders(body);
      return {
        ...headers,
        "svix-signature": `${Array(count).fill(forged).join(" ")} ${headers["svix-signature"]}`,
      };
    };
    expect((await hook(event, behind(5))).status).toBe(400);
    expect((await hook(event, behind(4))).status).toBe(200);
  });

  it("compares with Workers' constant-time check where there is one", async () => {
    const timingSafeEqual = vi.fn((a: Uint8Array, b: Uint8Array) =>
      a.every((byte, i) => byte === b[i]),
    );
    Object.defineProperty(crypto.subtle, "timingSafeEqual", {
      value: timingSafeEqual,
      configurable: true,
    });
    try {
      expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
      expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
      expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false);
      expect(timingSafeEqual).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(crypto.subtle, "timingSafeEqual");
    }
    // And byte by byte without it.
    expect(equalBytes(new Uint8Array([7, 8]), new Uint8Array([7, 8]))).toBe(true);
    expect(equalBytes(new Uint8Array([7, 8]), new Uint8Array([8, 8]))).toBe(false);
  });
});

describe("reading an event", () => {
  const here = { domain: "onmyhop.com", environment: "production" };

  it("finds nothing to do in what isn't an email event", () => {
    for (const event of [null, "x", 1, [], {}, { type: "email.complained" }, { data: {} }]) {
      expect(readResendEvent(event, here)).toBeNull();
    }
    // Without Hop's own domain (no EMAIL_FROM), nothing counts, not even an event without a sender.
    expect(readResendEvent(emailEvent("email.complained"), { ...here, domain: "" })).toBeNull();
    const unsent = {
      type: "email.complained",
      data: { to: ["alex@example.com"], tags: { env: "production" } },
    };
    expect(readResendEvent(unsent, { ...here, domain: "" })).toBeNull();
  });

  it("is about this environment's emails only", () => {
    const fromStaging = emailEvent("email.complained", { tags: { env: "staging" } });
    expect(readResendEvent(fromStaging, here)).toBeNull();
    expect(readResendEvent(fromStaging, { ...here, environment: "staging" })).not.toBeNull();
    // Sent before emails were tagged, or by something else.
    expect(readResendEvent(emailEvent("email.complained", { tags: {} }), here)).toBeNull();
    expect(readResendEvent(emailEvent("email.complained", { tags: undefined }), here)).toBeNull();
    expect(
      readResendEvent(emailEvent("email.complained"), { ...here, environment: "" }),
    ).toBeNull();
    // Nor does an empty tag match an environment that isn't set.
    expect(
      readResendEvent(emailEvent("email.complained", { tags: { env: "" } }), {
        ...here,
        environment: "",
      }),
    ).toBeNull();
    // Tags as a list of names and values, as they're sent.
    const listed = emailEvent("email.complained", {
      tags: [
        { name: "category", value: "welcome" },
        { name: "env", value: "production" },
      ],
    });
    expect(readResendEvent(listed, here)?.suppress?.reason).toBe("complained");
  });

  it("says which email never arrived, and which addresses to stop emailing", () => {
    const id = "email_7";
    expect(readResendEvent(bounce("Permanent", { email_id: id }), here)).toEqual({
      undelivered: id,
      suppress: { addresses: ["alex@example.com"], reason: "bounced" },
    });
    for (const type of ["Transient", "Undetermined"]) {
      expect(readResendEvent(bounce(type, { email_id: id }), here)).toEqual({
        undelivered: id,
        suppress: null,
      });
    }
    expect(
      readResendEvent(emailEvent("email.failed", { email_id: id, failed: { reason: "x" } }), here),
    ).toEqual({ undelivered: id, suppress: null });
    expect(readResendEvent(emailEvent("email.suppressed", { email_id: id }), here)).toEqual({
      undelivered: id,
      suppress: { addresses: ["alex@example.com"], reason: "suppressed" },
    });
    // A spam report means it did arrive.
    expect(readResendEvent(emailEvent("email.complained", { email_id: id }), here)).toEqual({
      undelivered: null,
      suppress: { addresses: ["alex@example.com"], reason: "complained" },
    });
    expect(readResendEvent(emailEvent("email.delivered"), here)).toBeNull();
    expect(readResendEvent(bounce("Transient", { email_id: 7 }), here)?.undelivered).toBeNull();
    expect(
      readResendEvent(bounce("Transient", { email_id: "x".repeat(200) }), here)?.undelivered,
    ).toBeNull();
  });
});

describe("normalising an address", () => {
  it("gives exactly what SQLite's lower(trim()) gives, so SQL and code agree", async () => {
    for (const address of [
      "  Alex@Example.COM ",
      "\tTab@Example.com",
      "MÜLLER@Straße.de",
      "Ångström@example.se",
      "İstanbul@example.com",
      "plain@example.com",
      "   ",
      "",
      ` ${" ".repeat(50)}x${" ".repeat(50)} `,
    ]) {
      const row = await db.get<{ normalized: string }>(
        sql`select lower(trim(${address})) as normalized`,
      );
      expect(normalizeAddress(address)).toBe(row?.normalized);
    }
  });

  it("stays fast on long runs of spaces", () => {
    const started = performance.now();
    expect(normalizeAddress(`${" ".repeat(100_000)}x${" ".repeat(100_000)}y`)).toBe(
      `x${" ".repeat(100_000)}y`,
    );
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("an address Hop no longer emails", () => {
  const message = {
    to: "Alex@Example.com",
    subject: "Hi",
    html: "<p>Hi</p>",
    text: "Hi",
    idempotencyKey: "test/1",
    category: "test",
  };

  it("gets nothing, however its address is written", async () => {
    await suppress(db, ["alex@example.com"], "bounced");
    expect(await sendEmail(env, message)).toEqual({ status: "suppressed" });
    expect(await sendEmail(env, { ...message, to: " ALEX@example.com" })).toEqual({
      status: "suppressed",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await sendEmail(env, { ...message, to: "bea@example.com" })).toEqual({
      status: "sent",
      emailId: "email_1",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("is told apart from other environments' emails by a tag on each", async () => {
    await sendEmail({ ...env, ENVIRONMENT: "staging" }, message);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).tags).toEqual([
      { name: "category", value: "test" },
      { name: "env", value: "staging" },
    ]);
  });

  it("gets no welcome and no word that their account was deleted", async () => {
    await suppress(db, ["alex@example.com"], "complained");
    const alex = {
      id: "usr_1",
      email: "alex@example.com",
      emailVerified: true,
      name: "Alex",
      color: "mint",
      handle: "alex",
    };
    await sendWelcomeEmail(env, alex);
    await sendAccountDeletedEmail(env, alex);
    expect(fetch).not.toHaveBeenCalled();
    // The emails themselves are as before.
    expect((await accountDeletedEmail({ appUrl: env.APP_URL, handle: "alex" })).subject).toBe(
      "Your Hop account is deleted",
    );
  });

  it("is still sent Hop's team's own emails", async () => {
    await suppress(db, ["team@onmyhop.com"], "bounced");
    const result = await sendEmail(env, { ...message, to: "team@onmyhop.com", team: true });
    expect(result.status).toBe("sent");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("is listed once, under the address as the list keys it", async () => {
    await suppress(db, [" Alex@Example.com", "alex@example.com"], "bounced");
    const rows = await db.select().from(emailSuppressions);
    expect(rows.map((row) => row.email)).toEqual(["alex@example.com"]);
    const alex = await db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, "alex@example.com"))
      .get();
    expect(alex?.reason).toBe("bounced");
  });
});

describe("the list's entries", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function account(id: string, email: string, verified = true) {
    const now = Date.now();
    await db.insert(users).values({
      id,
      oidcSub: `sub-${id}`,
      handle: id,
      email,
      emailVerified: verified,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("go a year after they're added", async () => {
    const now = Date.now();
    await suppress(db, ["old@example.com"], "bounced", now - KEEP_SUPPRESSIONS_MS - DAY);
    await suppress(db, ["recent@example.com"], "bounced", now - KEEP_SUPPRESSIONS_MS + DAY);
    await forgetOldSuppressions(db, now);
    expect(Object.keys(await reasons())).toEqual(["recent@example.com"]);
  });

  it("remember emails that never arrived for a month", async () => {
    const now = Date.now();
    await letGoUndelivered(db, "email_old", now - KEEP_UNDELIVERED_MS - DAY);
    await letGoUndelivered(db, "email_recent", now - KEEP_UNDELIVERED_MS + DAY);
    await forgetOldSuppressions(db, now);
    const left = await db.select({ id: undeliveredEmails.emailId }).from(undeliveredEmails);
    expect(left.map((row) => row.id)).toEqual(["email_recent"]);
  });

  it("go with the account, however its address is written", async () => {
    await account("usr_alex", " Alex@Example.com");
    await suppress(db, ["alex@example.com", "bea@example.com"], "complained");
    await deleteAccount(db, "usr_alex");
    expect(Object.keys(await reasons())).toEqual(["bea@example.com"]);
  });

  it("stay for an address the account never proved was its own", async () => {
    await account("usr_alex", "alex@example.com", false);
    await suppress(db, ["alex@example.com"], "bounced");
    await deleteAccount(db, "usr_alex");
    expect(Object.keys(await reasons())).toEqual(["alex@example.com"]);
  });

  it("aren't kept for a deleted account that still shows the address", async () => {
    await account("usr_alex", "alex@example.com");
    // As if erasing it hadn't got to its address yet.
    await account("usr_gone", "alex@example.com");
    await db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, "usr_gone"));
    await suppress(db, ["alex@example.com"], "bounced");
    await deleteAccount(db, "usr_alex");
    expect(await reasons()).toEqual({});
  });

  it("stay while another account still has the address", async () => {
    await account("usr_alex", "alex@example.com");
    await account("usr_alex2", "ALEX@example.com");
    await suppress(db, ["alex@example.com"], "bounced");
    await deleteAccount(db, "usr_alex");
    expect(Object.keys(await reasons())).toEqual(["alex@example.com"]);
    await deleteAccount(db, "usr_alex2");
    expect(await reasons()).toEqual({});
  });
});
