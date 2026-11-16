import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db";
import { blockKeys, blocks } from "../db/schema";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { isSecureUrl } from "./http";

/**
 * Senders: whoever uploads to someone's Hop, usually without an account.
 *
 * An athlete can block a sender. One who was signed in is blocked by account.
 * Anyone else is blocked by a random key their browser keeps (the hop_sender
 * cookie), not by IP address: at an event the whole crowd can share one
 * network, and blocking one troll mustn't block them all. Clearing cookies
 * gets around it, so blocking is a nuisance filter, with reporting (which
 * reaches Hop's team) for anything worse.
 *
 * Only a hash of the key is stored, on each clip and block. The upload pass
 * carries it too (uploads.ts), so a pass's uploads all count as one sender,
 * with or without the cookie, and a block ends the pass.
 */
const SENDER_COOKIE = "hop_sender";
const KEY = /^[A-Za-z0-9_-]{43}$/;
const YEAR_S = 365 * 24 * 60 * 60;

/**
 * The browser's sender key as stored (hashed), giving it one if it has none.
 * Each use keeps it another year, so a block lasts while they keep sending.
 * Upload routes only: the cookie is limited to /api/hops.
 */
export async function senderKey(c: Context<AppEnv>): Promise<string> {
  let key = getCookie(c, SENDER_COOKIE);
  if (!key || !KEY.test(key)) key = randomToken();
  setCookie(c, SENDER_COOKIE, key, {
    httpOnly: true,
    secure: isSecureUrl(c.env.APP_URL),
    sameSite: "Lax",
    path: "/api/hops",
    maxAge: YEAR_S,
  });
  return sha256Hex(key);
}

/**
 * SQL: whether this athlete blocked this sender: this browser key, or this
 * account. Never the athlete themselves, signed in to their own Hop.
 */
export function blockedSql(ownerId: string, sender: string, contributorUserId: string | null): SQL {
  if (contributorUserId === ownerId) return sql`0`;
  const byKey = sql`exists (select 1 from ${blockKeys} where ${and(eq(blockKeys.ownerId, ownerId), eq(blockKeys.senderKey, sender))})`;
  if (!contributorUserId) return byKey;
  const byAccount = sql`exists (select 1 from ${blocks} where ${and(eq(blocks.ownerId, ownerId), eq(blocks.contributorUserId, contributorUserId))})`;
  return sql`(${byKey} or ${byAccount})`;
}

/** Whether this athlete blocked this sender. */
export async function isBlocked(
  db: Db,
  ownerId: string,
  sender: string,
  contributorUserId: string | null,
): Promise<boolean> {
  const row = await db.get<{ blocked: number }>(
    sql`select ${blockedSql(ownerId, sender, contributorUserId)} as blocked`,
  );
  return Boolean(row?.blocked);
}
