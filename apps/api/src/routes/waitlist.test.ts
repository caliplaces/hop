import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { waitlist } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { createTestD1 } from "../test/d1";

let env: Env;
let allow: boolean;
/** What Cloudflare's siteverify answers, and the forms it was sent. */
let siteverify: { success: boolean; hostname?: string; action?: string };
let verified: FormData[];

beforeEach(() => {
  allow = true;
  siteverify = { success: true, hostname: "onmyhop.com", action: "waitlist" };
  verified = [];
  env = {
    DB: createTestD1(),
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    WAITLIST_LIMITER: { limit: async () => ({ success: allow }) } as RateLimit,
  } as Env;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(String(input)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    verified.push(init?.body as FormData);
    return Response.json(siteverify);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function join(body: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(
    new Request("https://onmyhop.com/api/waitlist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
    {} as ExecutionContext,
  );
}

const rows = () => getDb(env.DB).select().from(waitlist);

describe("joining the waitlist", () => {
  it("adds the email once, lowercased, and answers the same the second time", async () => {
    const first = await join({ email: "  Maya@Example.com ", turnstileToken: "token-1" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    const again = await join({ email: "maya@example.COM", turnstileToken: "token-2" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ email: "maya@example.com", notifiedAt: null });
  });

  it("checks the token with Cloudflare, for this visitor", async () => {
    await join({ email: "maya@example.com", turnstileToken: "token-1" });
    expect(verified).toHaveLength(1);
    expect(verified[0]?.get("secret")).toBe("turnstile-secret");
    expect(verified[0]?.get("response")).toBe("token-1");
    expect(verified[0]?.get("remoteip")).toBe("203.0.113.7");
  });

  it("refuses addresses that aren't emails, and bodies that aren't JSON", async () => {
    for (const email of ["", "maya", "maya@", `${"a".repeat(250)}@example.com`]) {
      const response = await join({ email, turnstileToken: "token" });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_email" });
    }
    expect((await join("not json")).status).toBe(400);
    expect(await rows()).toHaveLength(0);
    expect(verified).toHaveLength(0);
  });
});

describe("Turnstile", () => {
  it("is required outside local development", async () => {
    const response = await join({ email: "maya@example.com" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "turnstile_failed" });
    expect(await rows()).toHaveLength(0);
  });

  it("must pass, on this site, for the waitlist", async () => {
    for (const answer of [
      { success: false },
      { success: true, hostname: "evil.example", action: "waitlist" },
      // A token minted for the upload form doesn't count here.
      { success: true, hostname: "onmyhop.com", action: "upload" },
    ]) {
      siteverify = answer;
      expect((await join({ email: "maya@example.com", turnstileToken: "token" })).status).toBe(403);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("can be left out locally, where the widget may not load", async () => {
    env.ENVIRONMENT = "development";
    expect((await join({ email: "maya@example.com" })).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });
});

describe("limits", () => {
  it("turns away a flood from one IP before doing any work", async () => {
    allow = false;
    const response = await join({ email: "maya@example.com", turnstileToken: "token" });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
    expect(verified).toHaveLength(0);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses oversized bodies", async () => {
    const response = await join({ email: "maya@example.com", padding: "a".repeat(20_000) });
    expect(response.status).toBe(413);
  });
});
