import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { fail, isSecureUrl } from "./http";

const SESSION_COOKIE = "hop_session";
const DAY_MS = 24 * 60 * 60 * 1000;

type SessionKind = "web" | "app";

/**
 * How long each kind of session lasts, and when using it pushes the expiry
 * back. Website sessions last 30 days and renew in their last week. The app's
 * last 90 days from when it was last opened, renewed at most once a day,
 * because people may only open it at events, and never beyond a year in all.
 */
const POLICY: Record<SessionKind, { ttl: number; renewWithin: number; maxAge: number }> = {
  web: { ttl: 30 * DAY_MS, renewWithin: 7 * DAY_MS, maxAge: Number.POSITIVE_INFINITY },
  app: { ttl: 90 * DAY_MS, renewWithin: 89 * DAY_MS, maxAge: 365 * DAY_MS },
};

/**
 * App session tokens carry a prefix, so they can't be mistaken for the other
 * bearer tokens the API accepts, like upload tokens.
 */
const APP_TOKEN_PREFIX = "hs_";
/** An app session token as the app sends it: `Authorization: Bearer hs_…`. */
const BEARER = /^Bearer (hs_[A-Za-z0-9_-]{43})$/;

function writeCookie(c: Context<AppEnv>, token: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureUrl(c.env.APP_URL),
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

async function insertSession(env: Env, userId: string, kind: SessionKind) {
  const token = kind === "app" ? `${APP_TOKEN_PREFIX}${randomToken()}` : randomToken();
  const now = Date.now();
  const expiresAt = now + POLICY[kind].ttl;
  await getDb(env.DB)
    .insert(sessions)
    .values({ id: await sha256Hex(token), userId, kind, createdAt: now, expiresAt });
  return { token, expiresAt };
}

/** Signs the website in: a session in an httpOnly cookie. */
export async function createSession(c: Context<AppEnv>, userId: string) {
  const { token, expiresAt } = await insertSession(c.env, userId, "web");
  writeCookie(c, token, expiresAt);
}

/** Signs the app in: a bearer token it keeps in the Keychain. */
export async function createAppSession(env: Env, userId: string) {
  return insertSession(env, userId, "app");
}

export async function destroySession(c: Context<AppEnv>) {
  const sessionId = c.get("sessionId");
  if (sessionId) await getDb(c.env.DB).delete(sessions).where(eq(sessions.id, sessionId));
  if (getCookie(c, SESSION_COOKIE)) deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Resolves the signed-in user, if any: from the app's session token when the
 * request carries one, otherwise from the website's cookie.
 */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);

  const bearer = c.req.header("authorization")?.match(BEARER)?.[1];
  const kind: SessionKind = bearer ? "app" : "web";
  const token = bearer ?? getCookie(c, SESSION_COOKIE);

  if (token) {
    const id = await sha256Hex(token);
    const db = getDb(c.env.DB);
    const row = await db
      .select({ user: users, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), eq(sessions.kind, kind)))
      .get();
    const now = Date.now();
    const policy = POLICY[kind];
    const endOfLife = row ? row.createdAt + policy.maxAge : 0;
    if (row && row.expiresAt > now && endOfLife > now) {
      c.set("user", row.user);
      c.set("sessionId", id);
      if (row.expiresAt - now < policy.renewWithin) {
        const expiresAt = Math.min(now + policy.ttl, endOfLife);
        if (expiresAt > row.expiresAt) {
          await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
          if (kind === "web") writeCookie(c, token, expiresAt);
        }
      }
    } else if (kind === "web") {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
    }
  }
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return fail(c, 401, "unauthorized", "Sign in to continue.");
  await next();
});

/** Use after requireUser; narrows the user to non-null. */
export function currentUser(c: Context<AppEnv>) {
  const user = c.get("user");
  if (!user) throw new Error("currentUser() used without requireUser");
  return user;
}
