import * as oauth from "oauth4webapi";
import type { Env } from "../env";

let cached: { issuer: string; as: oauth.AuthorizationServer } | null = null;

/** Discovery document, cached per isolate. */
export async function authorizationServer(env: Env): Promise<oauth.AuthorizationServer> {
  if (cached?.issuer === env.OIDC_ISSUER) return cached.as;
  const issuer = new URL(env.OIDC_ISSUER);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer));
  cached = { issuer: env.OIDC_ISSUER, as };
  return as;
}

export function oidcClient(env: Env): oauth.Client {
  return { client_id: env.OIDC_CLIENT_ID };
}

export function redirectUri(env: Env): string {
  return `${env.APP_URL}/api/auth/callback`;
}

/** The iPhone app's client: public, so it proves itself with PKCE instead of a secret. */
export function appOidcClient(env: Env): oauth.Client {
  return { client_id: env.OIDC_APP_CLIENT_ID };
}

/**
 * Where Caliplaces sends the iPhone app back to. A custom scheme matching the
 * app's bundle id, registered on its developer app; must match exactly.
 */
export const APP_REDIRECT_URI = "com.onmyhop.app:/auth/callback";

/** Caliplaces only allows these scopes for third-party apps. */
export const OIDC_SCOPES = "openid profile email";
