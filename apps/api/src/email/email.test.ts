import { PALETTE } from "@hop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { sendEmail } from "./send";
import { tint } from "./theme";
import { sendWelcomeEmail, welcomeEmail } from "./welcome";

const ocean = PALETTE.find((c) => c.id === "ocean") as (typeof PALETTE)[number];

function env(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    EMAIL_FROM: "Hop <hello@onmyhop.com>",
    RESEND_API_KEY: "re_test",
    ...overrides,
  } as Env;
}

const athlete = {
  id: "usr_1",
  email: "matej@example.com",
  emailVerified: true,
  name: "Matej Matiasko",
  color: "ocean",
  handle: "matej",
};

function mockFetch(status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("welcome email", () => {
  it("leads with the athlete's link, in their colour", async () => {
    const email = await welcomeEmail({
      appUrl: "https://onmyhop.com",
      handle: "matej",
      name: "Matej Matiasko",
      color: ocean,
    });
    expect(email.subject).toBe("Your Hop is live: onmyhop.com/matej");
    expect(email.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(email.html).toContain('href="https://onmyhop.com/matej"');
    expect(email.html).toContain("https://onmyhop.com/email/cheer-ocean.png");
    expect(email.html).toContain("background-color:#2563EB");
    expect(email.html).toContain("Hi Matej!");
    expect(email.text).toContain("Your link: https://onmyhop.com/matej");
    expect(email.text).toContain("Open your inbox: https://onmyhop.com/app");
    expect(email.text).toContain("up to 5 GB each");
  });

  it("escapes names and skips the greeting without one", async () => {
    const hostile = await welcomeEmail({
      appUrl: "https://onmyhop.com",
      handle: "matej",
      name: '<img src=x onerror="alert(1)">',
      color: ocean,
    });
    expect(hostile.html).not.toContain("<img src=x");
    expect(hostile.html).toContain("&lt;img");

    const nameless = await welcomeEmail({
      appUrl: "https://onmyhop.com",
      handle: "matej",
      name: null,
      color: ocean,
    });
    expect(nameless.text).toContain("\nYour page is live.");
    expect(nameless.html).not.toContain("Hi ");
  });

  it("is sent once per account, only to verified addresses", async () => {
    const fetch = mockFetch();
    await sendWelcomeEmail(env(), { ...athlete, emailVerified: false });
    await sendWelcomeEmail(env(), { ...athlete, email: null });
    expect(fetch).not.toHaveBeenCalled();

    await sendWelcomeEmail(env(), athlete);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["idempotency-key"]).toBe("welcome/usr_1");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: "Hop <hello@onmyhop.com>",
      to: ["matej@example.com"],
      subject: "Your Hop is live: onmyhop.com/matej",
      tags: [{ name: "category", value: "welcome" }],
    });
    expect(body.html).toContain("onmyhop.com/matej");
    expect(body.text).toContain("onmyhop.com/matej");
  });
});

describe("sendEmail", () => {
  const message = {
    to: "a@example.com",
    subject: "Hi",
    html: "<p>Hi</p>",
    text: "Hi",
    idempotencyKey: "test/1",
    category: "test",
  };

  it("marks staging emails", async () => {
    const fetch = mockFetch();
    await sendEmail(env({ ENVIRONMENT: "staging" }), message);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).subject).toBe("[Staging] Hi");
  });

  it("throws when Resend refuses, so callers can log it", async () => {
    mockFetch(422);
    await expect(sendEmail(env(), message)).rejects.toThrow(/422/);
  });

  it("logs instead of sending in local development without a key", async () => {
    const fetch = mockFetch();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendEmail(env({ ENVIRONMENT: "development", RESEND_API_KEY: undefined }), message);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    await expect(sendEmail(env({ RESEND_API_KEY: undefined }), message)).rejects.toThrow(
      /RESEND_API_KEY/,
    );
  });
});

describe("tint", () => {
  it("mixes a colour into white", () => {
    expect(tint("#000000", 0)).toBe("#ffffff");
    expect(tint("#2563EB", 1)).toBe("#2563eb");
    expect(tint("#000000", 0.5)).toBe("#808080");
  });
});
