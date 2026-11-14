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
      name: "Alex Rider",
      email: "alex@example.com",
      email_verified: true,
    });
  }
  return new Response("unexpected request", { status: 500 });
}

function call(path: string, init: RequestInit = {}) {
  const request = new Request(`https://onmyhop.com/api${path}`, init);
  return worker.fetch(request, env, {} as ExecutionContext);
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

async function insertSession(kind: "web" | "app", expiresAt = Date.now() + DAY) {
  const now = Date.now();
  await db.insert(users).values({
    id: "usr_test",
    oidcSub: "sub-test",
    name: "Test",
    createdAt: now,
    updatedAt: now,
  });
  const token = randomToken();
  await db
    .insert(sessions)
    .values({ id: await sha256Hex(token), userId: "usr_test", kind, createdAt: now, expiresAt });
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
    SESSION_SECRET: "test-secret",
  } as Env;
  db = getDb(DB);
  tokenRequests = [];
  idTokenNonce = "";
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

    await db.delete(users);
    const app = await insertSession("app");
    expect(await me({ authorization: `Bearer ${app}` })).toMatchObject({ id: "usr_test" });
    expect(await me({ cookie: `hop_session=${app}` })).toBeNull();
  });

  it("ignore the cookie when a request carries an Authorization header", async () => {
    const web = await insertSession("web");
    expect(await me({ cookie: `hop_session=${web}`, authorization: "Basic abc" })).toBeNull();
  });

  it("renew app sessions to 90 days without setting a cookie", async () => {
    const app = await insertSession("app", Date.now() + 80 * DAY);
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
    const app = await insertSession("app", Date.now() - 1);
    expect(await me({ authorization: `Bearer ${app}` })).toBeNull();
  });
});
