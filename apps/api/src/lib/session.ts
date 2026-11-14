import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { fail, isSecureUrl } from "./http";

const SESSION_COOKIE = "hop_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Extend sessions that are used within the last week of their lifetime. */
const SESSION_RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function writeCookie(c: Context<AppEnv>, token: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureUrl(c.env.APP_URL),
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await getDb(c.env.DB)
    .insert(sessions)
    .values({ id: await sha256Hex(token), userId, createdAt: now, expiresAt });
  writeCookie(c, token, expiresAt);
}

export async function destroySession(c: Context<AppEnv>) {
  const sessionId = c.get("sessionId");
  if (sessionId) await getDb(c.env.DB).delete(sessions).where(eq(sessions.id, sessionId));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Resolves the signed-in user (if any) from the session cookie. */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const id = await sha256Hex(token);
    const db = getDb(c.env.DB);
    const row = await db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .get();
    const now = Date.now();
    if (row && row.expiresAt > now) {
      c.set("user", row.user);
      c.set("sessionId", id);
      if (row.expiresAt - now < SESSION_RENEW_WINDOW_MS) {
        const expiresAt = now + SESSION_TTL_MS;
        await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
        writeCookie(c, token, expiresAt);
      }
    } else {
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
