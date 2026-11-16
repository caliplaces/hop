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
 * The iPhone app's first callback: a custom scheme matching its bundle id.
 * Any app can claim a custom scheme, so it's being replaced by the https one
 * below, environment by environment.
 */
export const APP_SCHEME_REDIRECT_URI = "com.onmyhop.app:/auth/callback";

/** The app's https callback. Its web authentication session catches the
 *  redirect, so this page only ever loads when something went wrong. */
export const APP_CALLBACK_PATH = "/api/auth/app/callback";

/**
 * Where Caliplaces sends the iPhone app back to, or null when the setting is
 * anything but a valid choice, so a typo turns app sign-in off rather than
 * quietly falling back to the custom scheme.
 *
 * - "https": this site's callback page. Only Hop can catch it, because Apple
 *   checks that this domain lists the app (see appSiteAssociation).
 * - "scheme": the custom scheme, while an environment moves off it.
 *
 * Every URL must be registered on the app's developer app.
 */
export function appRedirectUri(env: Env): string | null {
  switch (env.OIDC_APP_REDIRECT) {
    case "https": {
      const url = new URL(APP_CALLBACK_PATH, env.APP_URL);
      // The app catches https callbacks on a plain host only.
      return url.protocol === "https:" && url.port === "" ? url.toString() : null;
    }
    case "scheme":
      return APP_SCHEME_REDIRECT_URI;
    default:
      return null;
  }
}

/**
 * Whether a flow's recorded redirect is one this environment uses: its https
 * callback, or the custom scheme for flows started before switching. A flow
 * signed elsewhere with another environment's redirect doesn't count.
 */
export function isOwnAppRedirect(env: Env, redirectUri: string): boolean {
  return (
    redirectUri === APP_SCHEME_REDIRECT_URI ||
    redirectUri === new URL(APP_CALLBACK_PATH, env.APP_URL).toString()
  );
}

/**
 * Whether `callback` is a redirect to `redirectUri`: same scheme, host and
 * path. A sanity check on what the app sends; what protects the code is that
 * it's exchanged with the flow's own redirect_uri, which Caliplaces binds it to.
 */
export function isRedirectTo(callback: URL, redirectUri: string): boolean {
  const expected = new URL(redirectUri);
  return (
    callback.protocol === expected.protocol &&
    callback.host === expected.host &&
    callback.pathname === expected.pathname
  );
}

/** What the app's web authentication session waits for, for `redirectUri`. */
export function appCallback(
  redirectUri: string,
): { host: string; path: string } | { scheme: string } {
  const url = new URL(redirectUri);
  return url.protocol === "https:"
    ? { host: url.hostname, path: url.pathname }
    : { scheme: url.protocol.slice(0, -1) };
}

/**
 * The apple-app-site-association file: it tells Apple this site belongs to
 * the Hop app, which is what lets the app, and only the app, catch its
 * https sign-in callback (webcredentials).
 */
export const APP_SITE_ASSOCIATION_PATH = "/.well-known/apple-app-site-association";

export function appSiteAssociation(request: Request, env: Env): Response {
  const headers = { "x-content-type-options": "nosniff" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
  }
  // Without the app's identity there's nothing true to say.
  if (!env.APPLE_TEAM_ID || !env.APPLE_BUNDLE_ID) {
    return new Response(null, { status: 404, headers });
  }
  return Response.json(
    { webcredentials: { apps: [`${env.APPLE_TEAM_ID}.${env.APPLE_BUNDLE_ID}`] } },
    { headers: { ...headers, "cache-control": "public, max-age=3600" } },
  );
}

/** Caliplaces only allows these scopes for third-party apps. */
export const OIDC_SCOPES = "openid profile email";
