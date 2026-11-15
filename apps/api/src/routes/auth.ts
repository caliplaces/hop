import { colorFor, type Me } from "@hop/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as oauth from "oauth4webapi";
import { z } from "zod";
import { getDb } from "../db";
import { type UserRow, users } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { newId, signPayload, verifyPayload } from "../lib/crypto";
import { clientIp, fail, isSecureUrl, safeReturnTo } from "../lib/http";
import {
  APP_SCHEME_REDIRECT_URI,
  appCallback,
  appOidcClient,
  appRedirectUri,
  authorizationServer,
  isOwnAppRedirect,
  isRedirectTo,
  OIDC_SCOPES,
  oidcClient,
  redirectUri,
} from "../lib/oidc";
import { createAppSession, createSession, destroySession } from "../lib/session";
import { validate } from "../lib/validate";

const FLOW_COOKIE = "hop_oidc";
const FLOW_TTL_MS = 10 * 60 * 1000;

type FlowState = {
  purpose: "oidc-flow";
  exp: number;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

/**
 * The iPhone app's sign-in, handed to the app between /app/start and
 * /app/session. Signed, not encrypted: the app is the client it belongs to.
 * Someone who intercepts the redirect gets a code but not this, and the code
 * is useless without its PKCE verifier.
 */
type AppFlowState = {
  purpose: "app-oidc-flow";
  exp: number;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Where this flow sends the app back to, so a setting changed meanwhile can't break it. */
  redirectUri?: string;
};

/**
 * OIDC errors can carry the callback's code and state, or the token
 * endpoint's reply, in their cause. Log only what identifies the failure.
 */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  const details = error as { code?: unknown; error?: unknown; status?: unknown };
  return {
    name: error.name,
    message: error.message,
    code: details.code,
    error: details.error,
    status: details.status,
  };
}

/** Sign-in calls out to Caliplaces, so it's limited per IP. */
async function tooManyAttempts(env: Env, ip: string): Promise<boolean> {
  const { success } = await env.AUTH_LIMITER.limit({ key: `auth:${ip}` });
  return !success;
}

const appSessionSchema = z.object({
  flow: z.string().min(1).max(2048),
  callbackUrl: z.string().min(1).max(4096),
});

/** A fresh state, nonce and PKCE verifier, and the authorization URL that uses them. */
async function startFlow(env: Env, clientId: string, redirect: string) {
  const as = await authorizationServer(env);
  if (!as.authorization_endpoint) throw new Error("OIDC issuer has no authorization_endpoint");
  const flow = {
    exp: Date.now() + FLOW_TTL_MS,
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    codeVerifier: oauth.generateRandomCodeVerifier(),
  };
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OIDC_SCOPES);
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);
  url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(flow.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { flow, url };
}

/**
 * Trades an authorization code for tokens, reads the profile and creates or
 * updates the Hop user. Shared by the website's and the app's sign-in.
 */
async function signInWithCode(
  env: Env,
  options: {
    client: oauth.Client;
    clientAuth: oauth.ClientAuth;
    params: URLSearchParams;
    redirectUri: string;
    codeVerifier: string;
    nonce: string;
  },
): Promise<UserRow> {
  const as = await authorizationServer(env);
  const { client } = options;
  const tokenResponse = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    options.clientAuth,
    options.params,
    options.redirectUri,
    options.codeVerifier,
  );
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse, {
    expectedNonce: options.nonce,
    requireIdToken: true,
  });
  const idClaims = oauth.getValidatedIdTokenClaims(tokens);
  if (!idClaims) throw new Error("OIDC token response had no ID token");

  // Profile claims aren't guaranteed in the ID token, so ask userinfo too.
  const info = await oauth.processUserInfoResponse(
    as,
    client,
    idClaims.sub,
    await oauth.userInfoRequest(as, client, tokens.access_token),
  );

  const email = typeof info.email === "string" ? info.email : null;
  const emailVerified = info.email_verified === true;
  const name =
    (typeof info.name === "string" && info.name.trim()) ||
    (typeof info.preferred_username === "string" && info.preferred_username.trim()) ||
    null;

  const now = Date.now();
  return getDb(env.DB)
    .insert(users)
    .values({
      id: newId("usr"),
      oidcSub: idClaims.sub,
      email,
      emailVerified,
      name,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.oidcSub,
      set: { email, emailVerified, name, updatedAt: now },
    })
    .returning()
    .get();
}

export function toMe(user: AppEnv["Variables"]["user"]): Me | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    handle: user.handle,
    activeHopId: user.activeHopId,
    color: colorFor(user.color, user.id).id,
    emailNewClips: user.emailNewClips,
  };
}

export const authRoutes = new Hono<AppEnv>()
  .get("/login", async (c) => {
    if (!c.env.OIDC_CLIENT_ID || !c.env.OIDC_CLIENT_SECRET) {
      console.error("OIDC_CLIENT_ID / OIDC_CLIENT_SECRET are not configured");
      return c.redirect("/?authError=failed");
    }
    const { flow, url } = await startFlow(c.env, c.env.OIDC_CLIENT_ID, redirectUri(c.env));
    const state: FlowState = {
      purpose: "oidc-flow",
      ...flow,
      returnTo: safeReturnTo(c.req.query("returnTo"), c.env.APP_URL),
    };
    setCookie(c, FLOW_COOKIE, await signPayload(c.env.SESSION_SECRET, state), {
      httpOnly: true,
      secure: isSecureUrl(c.env.APP_URL),
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: FLOW_TTL_MS / 1000,
    });
    return c.redirect(url.toString());
  })

  .get("/callback", async (c) => {
    const flow = await verifyPayload<FlowState>(
      c.env.SESSION_SECRET,
      getCookie(c, FLOW_COOKIE),
      "oidc-flow",
    );
    deleteCookie(c, FLOW_COOKIE, { path: "/api/auth" });
    if (!flow) return c.redirect("/?authError=expired");
    if (await tooManyAttempts(c.env, clientIp(c))) return c.redirect("/?authError=failed");

    const as = await authorizationServer(c.env);
    const client = oidcClient(c.env);

    let params: URLSearchParams;
    try {
      params = oauth.validateAuthResponse(as, client, new URL(c.req.url), flow.state);
    } catch (error) {
      console.warn("OIDC authorization response rejected", describeError(error));
      return c.redirect("/?authError=denied");
    }

    // Any failure past this point (token exchange, userinfo, database) sends the
    // user back to the landing page with a message instead of a raw error page.
    let userId: string;
    try {
      const user = await signInWithCode(c.env, {
        client,
        clientAuth: oauth.ClientSecretBasic(c.env.OIDC_CLIENT_SECRET),
        params,
        redirectUri: redirectUri(c.env),
        codeVerifier: flow.codeVerifier,
        nonce: flow.nonce,
      });
      userId = user.id;
    } catch (error) {
      console.error("OIDC sign-in failed", describeError(error));
      return c.redirect("/?authError=failed");
    }

    await createSession(c, userId);
    // Re-validate: the flow cookie is signed, but this keeps the guarantee local.
    return c.redirect(safeReturnTo(flow.returnTo, c.env.APP_URL));
  })

  /**
   * The iPhone app's sign-in, step 1: a fresh flow and the URL to open in a
   * web authentication session.
   */
  .post("/app/start", async (c) => {
    if (await tooManyAttempts(c.env, clientIp(c))) {
      return fail(c, 429, "rate_limited", "Too many sign-in attempts. Please wait a minute.");
    }
    if (!c.env.OIDC_APP_CLIENT_ID) {
      return fail(c, 503, "unavailable", "Signing in from the app isn't set up here.");
    }
    const appRedirect = appRedirectUri(c.env);
    if (!appRedirect) {
      console.error('auth: OIDC_APP_REDIRECT must be "https" or "scheme"');
      return fail(c, 503, "unavailable", "Signing in from the app isn't set up here.");
    }
    const { flow, url } = await startFlow(c.env, c.env.OIDC_APP_CLIENT_ID, appRedirect);
    const state: AppFlowState = { purpose: "app-oidc-flow", ...flow, redirectUri: appRedirect };
    return c.json({
      authorizeUrl: url.toString(),
      flow: await signPayload(c.env.SESSION_SECRET, state),
      // What the app's web authentication session waits for.
      callback: appCallback(appRedirect),
    });
  })

  /**
   * Step 2: the app hands back its flow and the URL Caliplaces redirected it
   * to. The code is exchanged here, so the app only ever holds a Hop session.
   */
  .post("/app/session", validate("json", appSessionSchema), async (c) => {
    if (await tooManyAttempts(c.env, clientIp(c))) {
      return fail(c, 429, "rate_limited", "Too many sign-in attempts. Please wait a minute.");
    }
    if (!c.env.OIDC_APP_CLIENT_ID) {
      return fail(c, 503, "unavailable", "Signing in from the app isn't set up here.");
    }
    const input = c.req.valid("json");
    const flow = await verifyPayload<AppFlowState>(
      c.env.SESSION_SECRET,
      input.flow,
      "app-oidc-flow",
    );
    if (!flow) return fail(c, 400, "expired", "Signing in took too long. Please try again.");

    let callback: URL;
    try {
      callback = new URL(input.callbackUrl);
    } catch {
      return fail(c, 400, "invalid_callback");
    }
    // Flows started before redirects were recorded used the custom scheme.
    const appRedirect = flow.redirectUri ?? APP_SCHEME_REDIRECT_URI;
    if (!isOwnAppRedirect(c.env, appRedirect) || !isRedirectTo(callback, appRedirect)) {
      return fail(c, 400, "invalid_callback");
    }

    const as = await authorizationServer(c.env);
    const client = appOidcClient(c.env);
    let params: URLSearchParams;
    try {
      params = oauth.validateAuthResponse(as, client, callback, flow.state);
    } catch (error) {
      console.warn("OIDC authorization response rejected (app)", describeError(error));
      return fail(c, 400, "denied", "Sign-in was cancelled or refused.");
    }

    let user: UserRow;
    try {
      user = await signInWithCode(c.env, {
        client,
        clientAuth: oauth.None(),
        params,
        redirectUri: appRedirect,
        codeVerifier: flow.codeVerifier,
        nonce: flow.nonce,
      });
    } catch (error) {
      console.error("OIDC sign-in failed (app)", describeError(error));
      return fail(c, 502, "failed", "Couldn't sign in with Caliplaces. Please try again.");
    }

    const session = await createAppSession(c.env, user.id);
    return c.json({ token: session.token, expiresAt: session.expiresAt, me: toMe(user) });
  })

  /**
   * The app's https callback. Its web authentication session catches the
   * redirect before this loads, so a browser only gets here if the app
   * didn't, and that sign-in can't finish. Nothing in the URL is used,
   * shown or kept.
   */
  .get("/app/callback", (c) => {
    c.header("cache-control", "no-store");
    return c.html(
      '<!doctype html><html lang="en"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        "<title>Hop</title><p>Signing in didn’t finish. Open the Hop app and try again.</p></html>",
    );
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  });

export async function findUserByHandle(db: ReturnType<typeof getDb>, handle: string) {
  return db.select().from(users).where(eq(users.handle, handle)).get();
}
