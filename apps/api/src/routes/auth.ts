import type { Me } from "@hop/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as oauth from "oauth4webapi";
import { getDb } from "../db";
import { users } from "../db/schema";
import type { AppEnv } from "../env";
import { newId, signPayload, verifyPayload } from "../lib/crypto";
import { isSecureUrl, safeReturnTo } from "../lib/http";
import { authorizationServer, OIDC_SCOPES, oidcClient, redirectUri } from "../lib/oidc";
import { createSession, destroySession } from "../lib/session";

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

export function toMe(user: AppEnv["Variables"]["user"]): Me | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    handle: user.handle,
    activeHopId: user.activeHopId,
  };
}

export const authRoutes = new Hono<AppEnv>()
  .get("/login", async (c) => {
    const as = await authorizationServer(c.env);
    if (!as.authorization_endpoint) throw new Error("OIDC issuer has no authorization_endpoint");

    const flow: FlowState = {
      purpose: "oidc-flow",
      exp: Date.now() + FLOW_TTL_MS,
      state: oauth.generateRandomState(),
      nonce: oauth.generateRandomNonce(),
      codeVerifier: oauth.generateRandomCodeVerifier(),
      returnTo: safeReturnTo(c.req.query("returnTo")),
    };
    setCookie(c, FLOW_COOKIE, await signPayload(c.env.SESSION_SECRET, flow), {
      httpOnly: true,
      secure: isSecureUrl(c.env.APP_URL),
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: FLOW_TTL_MS / 1000,
    });

    const url = new URL(as.authorization_endpoint);
    url.searchParams.set("client_id", c.env.OIDC_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri(c.env));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OIDC_SCOPES);
    url.searchParams.set("state", flow.state);
    url.searchParams.set("nonce", flow.nonce);
    url.searchParams.set(
      "code_challenge",
      await oauth.calculatePKCECodeChallenge(flow.codeVerifier),
    );
    url.searchParams.set("code_challenge_method", "S256");
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

    const as = await authorizationServer(c.env);
    const client = oidcClient(c.env);

    let params: URLSearchParams;
    try {
      params = oauth.validateAuthResponse(as, client, new URL(c.req.url), flow.state);
    } catch (error) {
      console.warn("OIDC authorization response rejected", error);
      return c.redirect("/?authError=denied");
    }

    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      oauth.ClientSecretBasic(c.env.OIDC_CLIENT_SECRET),
      params,
      redirectUri(c.env),
      flow.codeVerifier,
    );
    const tokens = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse, {
      expectedNonce: flow.nonce,
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

    const db = getDb(c.env.DB);
    const now = Date.now();
    const user = await db
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

    await createSession(c, user.id);
    return c.redirect(flow.returnTo);
  })

  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  });

export async function findUserByHandle(db: ReturnType<typeof getDb>, handle: string) {
  return db.select().from(users).where(eq(users.handle, handle)).get();
}
