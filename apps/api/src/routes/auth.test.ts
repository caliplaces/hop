import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
import type { Env } from "../env";
import worker from "../index";
import { base64url, randomToken, sha256Hex, signPayload } from "../lib/crypto";
import { createTestD1 } from "../test/d1";

const ISSUER = "https://auth.caliplaces.com";
const APP_CLIENT = "app-client";
const APP_REDIRECT = "com.onmyhop.app:/auth/callback";
const DAY = 24 * 60 * 60 * 1000;

let env: Env;
let db: ReturnType<typeof getDb>;
/** Requests that reached Caliplaces' token endpoint. */
let tokenRequests: { body: URLSearchParams; authorization: string | null }[];
/** The nonce the next ID token carries; tests set it from the flow they started. */
let idTokenNonce: string;
/** The name Caliplaces sends for the signed-in account. */
let userinfoName: string;
/** Whether the sign-in rate limiter lets the next request through. */
let allowSignIn: boolean;

function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  // Tokens from the token endpoint arrive over TLS, so their signature isn't checked.
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.c2lnbmF0dXJl`;
}

function caliplaces(url: string, init: RequestInit = {}): Response {
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Response.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/v2/authorize`,
      token_endpoint: `${ISSUER}/oauth/v2/token`,
      userinfo_endpoint: `${ISSUER}/oidc/v1/userinfo`,
      jwks_uri: `${ISSUER}/oauth/v2/keys`,
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }
  if (url === `${ISSUER}/oauth/v2/token`) {
    const headers = new Headers(init.headers);
    tokenRequests.push({
      body: new URLSearchParams(init.body as string),
      authorization: headers.get("authorization"),
    });
    const now = Math.floor(Date.now() / 1000);
    return Response.json({
      access_token: "caliplaces-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idToken({
        iss: ISSUER,
        sub: "caliplaces-user-1",
        aud: APP_CLIENT,
        iat: now,
        exp: now + 3600,
        nonce: idTokenNonce,
      }),
    });
  }
  if (url === `${ISSUER}/oidc/v1/userinfo`) {
    return Response.json({
      sub: "caliplaces-user-1",
      name: userinfoName,
      email: "alex@example.com",
      email_verified: true,
    });
  }
  return new Response("unexpected request", { status: 500 });
}

function call(path: string, init: RequestInit = {}) {
  const request = new Request(`https://onmyhop.com/api${path}`, init);
  // Work left running after a response (emails) isn't awaited here.
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  return worker.fetch(request, env, ctx as unknown as ExecutionContext);
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function start() {
  const response = await post("/auth/app/start");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { authorizeUrl: string; flow: string };
  const url = new URL(body.authorizeUrl);
  idTokenNonce = url.searchParams.get("nonce") ?? "";
  return { ...body, url, state: url.searchParams.get("state") ?? "" };
}

async function insertSession(
  kind: "web" | "app",
  { expiresAt = Date.now() + DAY, createdAt = Date.now() } = {},
) {
  const now = Date.now();
  await db
    .insert(users)
    .values({ id: "usr_test", oidcSub: "sub-test", name: "Test", createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const token = kind === "app" ? `hs_${randomToken()}` : randomToken();
  await db
    .insert(sessions)
    .values({ id: await sha256Hex(token), userId: "usr_test", kind, createdAt, expiresAt });
  return token;
}

async function me(headers: Record<string, string>) {
  const response = await call("/me", { headers });
  return ((await response.json()) as { me: { id: string } | null }).me;
}

beforeEach(() => {
  const DB = createTestD1();
  env = {
    DB,
    ENVIRONMENT: "production",
    APP_URL: "https://onmyhop.com",
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: "web-client",
    OIDC_CLIENT_SECRET: "web-secret",
    OIDC_APP_CLIENT_ID: APP_CLIENT,
    OIDC_APP_REDIRECT: "scheme",
    SESSION_SECRET: "test-secret",
    AUTH_LIMITER: { limit: async () => ({ success: allowSignIn }) } as RateLimit,
  } as Env;
  db = getDb(DB);
  tokenRequests = [];
  idTokenNonce = "";
  userinfoName = "Alex Rider";
  allowSignIn = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input instanceof Request) {
        return caliplaces(input.url, {
          headers: input.headers,
          body: await input.text(),
        });
      }
      return caliplaces(String(input), init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the apple-app-site-association file", () => {
  it("ties this site to the Hop app, for its sign-in callback", async () => {
    env.APPLE_TEAM_ID = "XH66L5M6JJ";
    env.APPLE_BUNDLE_ID = "com.onmyhop.app";
    const response = await worker.fetch(
      new Request("https://onmyhop.com/.well-known/apple-app-site-association"),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      webcredentials: { apps: ["XH66L5M6JJ.com.onmyhop.app"] },
    });
  });

  it("is only read, and says nothing without the app's identity", async () => {
    const aasa = (method: string) =>
      worker.fetch(
        new Request("https://onmyhop.com/.well-known/apple-app-site-association", { method }),
        env,
        {} as ExecutionContext,
      );
    env.APPLE_TEAM_ID = "XH66L5M6JJ";
    env.APPLE_BUNDLE_ID = "com.onmyhop.app";
    expect((await aasa("HEAD")).status).toBe(200);
    expect((await aasa("POST")).status).toBe(405);
    expect((await aasa("DELETE")).status).toBe(405);
    env.APPLE_TEAM_ID = "";
    expect((await aasa("GET")).status).toBe(404);
  });
});

describe("app sign-in", () => {
  it("starts a PKCE flow for the app's own client and redirect", async () => {
    const { url, flow } = await start();
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth/v2/authorize`);
    expect(url.searchParams.get("client_id")).toBe(APP_CLIENT);
    expect(url.searchParams.get("redirect_uri")).toBe(APP_REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(flow).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("tells the app which callback to wait for: the custom scheme, until https is on", async () => {
    const scheme = (await (await post("/auth/app/start")).json()) as { callback: unknown };
    expect(scheme.callback).toEqual({ scheme: "com.onmyhop.app" });

    env.OIDC_APP_REDIRECT = "https";
    const https = (await (await post("/auth/app/start")).json()) as { callback: unknown };
    expect(https.callback).toEqual({ host: "onmyhop.com", path: "/api/auth/app/callback" });
  });

  it("exchanges the code as a public client and returns a working bearer session", async () => {
    const { flow, state, url } = await start();
    const response = await post("/auth/app/session", {
      flow,
      callbackUrl: `${APP_REDIRECT}?code=the-code&state=${state}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      expiresAt: number;
      me: { name: string; email: string };
    };
    expect(body.me).toMatchObject({ name: "Alex Rider", email: "alex@example.com" });
    expect(body.token).toMatch(/^hs_[A-Za-z0-9_-]{43}$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now() + 89 * DAY);
    expect(response.headers.get("set-cookie")).toBeNull();

    // The code went to Caliplaces with the app's client, redirect and verifier, and no secret.
    expect(tokenRequests).toHaveLength(1);
    const [request] = tokenRequests;
    expect(request?.authorization).toBeNull();
    expect(request?.body.get("grant_type")).toBe("authorization_code");
    expect(request?.body.get("code")).toBe("the-code");
    expect(request?.body.get("client_id")).toBe(APP_CLIENT);
    expect(request?.body.get("redirect_uri")).toBe(APP_REDIRECT);
    const verifier = request?.body.get("code_verifier") ?? "";
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    );
    expect(challenge).toBe(url.searchParams.get("code_challenge"));

    const bearer = { authorization: `Bearer ${body.token}` };
    expect(await me(bearer)).toMatchObject({ name: "Alex Rider" });

    const row = await db.select().from(sessions).get();
    expect(row?.kind).toBe("app");

    expect((await post("/auth/logout", undefined, bearer)).status).toBe(200);
    expect(await me(bearer)).toBeNull();
  });

  it("starts a new, empty account for a Caliplaces login whose Hop account was deleted", async () => {
    const signIn = async () => {
      const { flow, state } = await start();
      const response = await post("/auth/app/session", {
        flow,
        callbackUrl: `${APP_REDIRECT}?code=the-code&state=${state}`,
      });
      return (await response.json()) as {
        token: string;
        me: { id: string; handle: string | null };
      };
    };
    const first = await signIn();
    await db.update(users).set({ handle: "alex" }).where(eq(users.id, first.me.id));
    const deleted = await call("/me", {
      method: "DELETE",
      headers: { authorization: `Bearer ${first.token}`, "content-type": "application/json" },
    });
    expect(deleted.status).toBe(200);

    const again = await signIn();
    expect(again.me.id).not.toBe(first.me.id);
    expect(again.me.handle).toBeNull();
    expect(await me({ authorization: `Bearer ${again.token}` })).toMatchObject({ id: again.me.id });
    expect(await me({ authorization: `Bearer ${first.token}` })).toBeNull();
  });

  it("rejects a tampered, expired or website flow", async () => {
    const { flow, state } = await start();
    const callbackUrl = `${APP_REDIRECT}?code=the-code&state=${state}`;
    const [body, sig] = flow.split(".");

    const tampered = await post("/auth/app/session", { flow: `${body}x.${sig}`, callbackUrl });
    expect(tampered.status).toBe(400);

    const expired = await signPayload(env.SESSION_SECRET, {
      purpose: "app-oidc-flow",
      exp: Date.now() - 1,
      state,
      nonce: "n",
      codeVerifier: "v",
    });
    expect((await post("/auth/app/session", { flow: expired, callbackUrl })).status).toBe(400);

    const website = await signPayload(env.SESSION_SECRET, {
      purpose: "oidc-flow",
      exp: Date.now() + 60_000,
      state,
      nonce: "n",
      codeVerifier: "v",
      returnTo: "/app",
    });
    expect((await post("/auth/app/session", { flow: website, callbackUrl })).status).toBe(400);
    expect(tokenRequests).toHaveLength(0);
  });

  it("signs in through the https callback, which only Hop can catch", async () => {
    env.OIDC_APP_REDIRECT = "https";
    const https = `${env.APP_URL}/api/auth/app/callback`;
    const { flow, state, url } = await start();
    expect(url.searchParams.get("redirect_uri")).toBe(https);

    for (const callbackUrl of [
      `https://evil.example/api/auth/app/callback?code=c&state=${state}`,
      `https://onmyhop.com/api/auth/elsewhere?code=c&state=${state}`,
      `http://onmyhop.com/api/auth/app/callback?code=c&state=${state}`,
      // An https flow doesn't take the custom scheme another app could claim.
      `${APP_REDIRECT}?code=c&state=${state}`,
    ]) {
      const refused = await post("/auth/app/session", { flow, callbackUrl });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "invalid_callback" });
    }

    const response = await post("/auth/app/session", {
      flow,
      callbackUrl: `${https}?code=the-code&state=${state}`,
    });
    expect(response.status).toBe(200);
    expect(tokenRequests[0]?.body.get("redirect_uri")).toBe(https);
  });

  it("is off, not quietly on the custom scheme, when the setting isn't valid", async () => {
    for (const setting of [undefined, "", "HTTPS", " https", "scheme ", "http"]) {
      env.OIDC_APP_REDIRECT = setting as Env["OIDC_APP_REDIRECT"];
      const response = await post("/auth/app/start");
      expect(response.status).toBe(503);
    }
    // https needs an https site with a plain host.
    env.OIDC_APP_REDIRECT = "https";
    for (const site of ["http://onmyhop.com", "https://onmyhop.com:8443"]) {
      env.APP_URL = site;
      expect((await post("/auth/app/start")).status).toBe(503);
    }
    env.APP_URL = "https://onmyhop.com/";
    const ok = (await (await post("/auth/app/start")).json()) as { callback: unknown };
    expect(ok.callback).toEqual({ host: "onmyhop.com", path: "/api/auth/app/callback" });
  });

  it("only finishes flows that come back to this site's own callback", async () => {
    // A correctly signed flow naming another environment's callback.
    const staging = "https://staging.onmyhop.com/api/auth/app/callback";
    const flow = await signPayload(env.SESSION_SECRET, {
      purpose: "app-oidc-flow",
      exp: Date.now() + 60_000,
      state: "s",
      nonce: "n",
      codeVerifier: "v".repeat(43),
      redirectUri: staging,
    });
    const response = await post("/auth/app/session", {
      flow,
      callbackUrl: `${staging}?code=c&state=s`,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_callback" });
    expect(tokenRequests).toHaveLength(0);
  });

  it("finishes a sign-in with the redirect it started with, if the setting changes meanwhile", async () => {
    const { flow, state } = await start();
    env.OIDC_APP_REDIRECT = "https";
    const response = await post("/auth/app/session", {
      flow,
      callbackUrl: `${APP_REDIRECT}?code=the-code&state=${state}`,
    });
    expect(response.status).toBe(200);
    expect(tokenRequests[0]?.body.get("redirect_uri")).toBe(APP_REDIRECT);
  });

  it("keeps a Caliplaces name only if it follows Hop's rules for public names", async () => {
    const signIn = async () => {
      const { flow, state } = await start();
      const response = await post("/auth/app/session", {
        flow,
        callbackUrl: `${APP_REDIRECT}?code=the-code&state=${state}`,
      });
      return ((await response.json()) as { me: { name: string | null } }).me;
    };
    userinfoName = "  Alex   Rider ";
    expect((await signIn()).name).toBe("Alex Rider");
    // One that would pass for a handle, or a badge, is dropped: their handle shows instead.
    userinfoName = `@admin ${String.fromCodePoint(0x2705)}`;
    expect((await signIn()).name).toBeNull();
  });

  it("shows a plain page if the callback ever opens in a browser, keeping nothing", async () => {
    const response = await call("/auth/app/callback?code=secret-code&state=s");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const page = await response.text();
    expect(page).toContain("Open the Hop app and try again");
    expect(page).not.toContain("secret-code");
    expect(page).not.toContain("<script");
  });

  it("rejects a callback to another redirect or with the wrong state", async () => {
    const { flow, state } = await start();
    for (const callbackUrl of [
      `https://evil.example/auth/callback?code=c&state=${state}`,
      `com.onmyhop.app:/elsewhere?code=c&state=${state}`,
      "not a url",
    ]) {
      const response = await post("/auth/app/session", { flow, callbackUrl });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_callback" });
    }

    const wrongState = await post("/auth/app/session", {
      flow,
      callbackUrl: `${APP_REDIRECT}?code=c&state=someone-elses`,
    });
    expect(wrongState.status).toBe(400);
    expect(await wrongState.json()).toMatchObject({ error: "denied" });

    const refused = await post("/auth/app/session", {
      flow,
      callbackUrl: `${APP_REDIRECT}?error=access_denied&state=${state}`,
    });
    expect(refused.status).toBe(400);
    expect(tokenRequests).toHaveLength(0);
  });

  it("is rate limited per IP", async () => {
    allowSignIn = false;
    expect((await post("/auth/app/start")).status).toBe(429);
    const session = await post("/auth/app/session", { flow: "x.y", callbackUrl: APP_REDIRECT });
    expect(session.status).toBe(429);
  });

  it("is unavailable where the app's client isn't configured", async () => {
    env.OIDC_APP_CLIENT_ID = "";
    expect((await post("/auth/app/start")).status).toBe(503);
  });
});

describe("sessions", () => {
  it("only accept app tokens as bearers and website tokens as cookies", async () => {
    const web = await insertSession("web");
    expect(await me({ cookie: `hop_session=${web}` })).toMatchObject({ id: "usr_test" });
    expect(await me({ authorization: `Bearer ${web}` })).toBeNull();
    expect(await me({ authorization: `Bearer hs_${web}` })).toBeNull();

    const app = await insertSession("app");
    expect(await me({ authorization: `Bearer ${app}` })).toMatchObject({ id: "usr_test" });
    expect(await me({ cookie: `hop_session=${app}` })).toBeNull();
  });

  it("keep using the cookie alongside other bearer tokens, like upload tokens", async () => {
    const web = await insertSession("web");
    const headers = { cookie: `hop_session=${web}`, authorization: `Bearer ${randomToken()}` };
    expect(await me(headers)).toMatchObject({ id: "usr_test" });
  });

  it("renew app sessions to 90 days without setting a cookie", async () => {
    const app = await insertSession("app", { expiresAt: Date.now() + 80 * DAY });
    const response = await call("/me", { headers: { authorization: `Bearer ${app}` } });
    expect(response.headers.get("set-cookie")).toBeNull();
    const row = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, await sha256Hex(app)))
      .get();
    expect(row?.expiresAt).toBeGreaterThan(Date.now() + 89 * DAY);
  });

  it("reject expired app sessions", async () => {
    const app = await insertSession("app", { expiresAt: Date.now() - 1 });
    expect(await me({ authorization: `Bearer ${app}` })).toBeNull();
  });

  it("end app sessions a year after sign-in, however recently used", async () => {
    const createdAt = Date.now() - 300 * DAY;
    const app = await insertSession("app", { createdAt, expiresAt: Date.now() + 10 * DAY });
    await call("/me", { headers: { authorization: `Bearer ${app}` } });
    const row = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, await sha256Hex(app)))
      .get();
    expect(row?.expiresAt).toBe(createdAt + 365 * DAY);

    const old = await insertSession("app", {
      createdAt: Date.now() - 366 * DAY,
      expiresAt: Date.now() + 10 * DAY,
    });
    expect(await me({ authorization: `Bearer ${old}` })).toBeNull();
  });
});
