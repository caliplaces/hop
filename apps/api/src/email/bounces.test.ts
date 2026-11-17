import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { emailSuppressions } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { createTestD1 } from "../test/d1";
import { emailEvent, signature, svixHeaders, WEBHOOK_SECRET } from "../test/svix";
import { accountDeletedEmail, sendAccountDeletedEmail } from "./account-deleted";
import { sendEmail } from "./send";
import { isSuppressed, suppress } from "./suppressions";
import { undeliverable, verifyResendWebhook } from "./webhook";
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

  it("finds nothing to do in what isn't an email event", () => {
    for (const event of [null, "x", 1, [], {}, { type: "email.complained" }, { data: {} }]) {
      expect(undeliverable(event, "onmyhop.com")).toBeNull();
    }
    // Without Hop's own domain (no EMAIL_FROM), nothing counts, not even an event without a sender.
    expect(undeliverable(emailEvent("email.complained"), "")).toBeNull();
    expect(
      undeliverable({ type: "email.complained", data: { to: ["alex@example.com"] } }, ""),
    ).toBeNull();
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
    expect(await sendEmail(env, message)).toBe("suppressed");
    expect(await sendEmail(env, { ...message, to: " ALEX@example.com" })).toBe("suppressed");
    expect(fetch).not.toHaveBeenCalled();
    expect(await sendEmail(env, { ...message, to: "bea@example.com" })).toBe("sent");
    expect(fetch).toHaveBeenCalledOnce();
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
    expect(await sendEmail(env, { ...message, to: "team@onmyhop.com", team: true })).toBe("sent");
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
