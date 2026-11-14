import { colorFor, normalizeHandle, type PublicConfig, type PublicHop } from "@hop/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { type HopRow, hops, type UserRow } from "../db/schema";
import type { AppEnv } from "../env";
import { fail } from "../lib/http";
import { findUserByHandle } from "./auth";

function toPublicHop(hop: HopRow, owner: UserRow): PublicHop {
  return {
    id: hop.id,
    slug: hop.slug,
    title: hop.title,
    status: hop.status,
    owner: {
      handle: owner.handle ?? "",
      name: owner.name,
      color: colorFor(owner.color, owner.id).id,
    },
  };
}

export const publicRoutes = new Hono<AppEnv>()
  .get("/config", (c) => c.json<PublicConfig>({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY }))

  /** onmyhop.com/<handle> uploads into the owner's active hop. */
  .get("/h/:handle", async (c) => {
    const db = getDb(c.env.DB);
    const owner = await findUserByHandle(db, normalizeHandle(c.req.param("handle")));
    if (!owner?.activeHopId) return fail(c, 404, "not_found", "This Hop doesn't exist.");
    const hop = await db.select().from(hops).where(eq(hops.id, owner.activeHopId)).get();
    if (!hop) return fail(c, 404, "not_found", "This Hop doesn't exist.");
    return c.json(toPublicHop(hop, owner));
  })

  .get("/h/:handle/:slug", async (c) => {
    const db = getDb(c.env.DB);
    const owner = await findUserByHandle(db, normalizeHandle(c.req.param("handle")));
    if (!owner) return fail(c, 404, "not_found", "This Hop doesn't exist.");
    const hop = await db
      .select()
      .from(hops)
      .where(and(eq(hops.ownerId, owner.id), eq(hops.slug, c.req.param("slug").toLowerCase())))
      .get();
    if (!hop) return fail(c, 404, "not_found", "This Hop doesn't exist.");
    return c.json(toPublicHop(hop, owner));
  });
