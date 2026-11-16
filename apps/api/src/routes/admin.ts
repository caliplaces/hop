import { Hono } from "hono";
import { getDb } from "../db";
import type { AppEnv, Env } from "../env";
import { fail } from "../lib/http";

import { adminStats } from "../stats";

/** Whether this account is one of Hop's team (ADMIN_USER_IDS). */
export function isAdmin(env: Env, userId: string): boolean {
  return (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

/**
 * Hop's private stats page. Anyone else, signed in or not, gets a plain
 * 404, so the page doesn't even say it exists.
 */
export const adminRoutes = new Hono<AppEnv>().get("/admin/stats", async (c) => {
  const user = c.get("user");
  if (!user || !isAdmin(c.env, user.id)) return fail(c, 404, "not_found");
  c.header("cache-control", "no-store");
  return c.json(await adminStats(getDb(c.env.DB)));
});
