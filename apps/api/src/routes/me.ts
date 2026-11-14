import {
  checkHandle,
  claimHandleSchema,
  createHopSchema,
  DEFAULT_HOP_SLUG,
  DEFAULT_HOP_TITLE,
  fileUrlsSchema,
  HOP_SLUG_PATTERN,
  type HopSummary,
  type InboxFile,
  type InboxPage,
  normalizeHandle,
  slugify,
  updateHopSchema,
  updateProfileSchema,
} from "@hop/shared";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { files, hops, users } from "../db/schema";
import type { AppEnv } from "../env";
import { newId } from "../lib/crypto";
import { removeFile } from "../lib/files";
import { fail } from "../lib/http";
import { currentUser, requireUser } from "../lib/session";
import { presignGet } from "../lib/storage";
import { validate } from "../lib/validate";
import { findUserByHandle, toMe } from "./auth";

const PAGE_SIZE = 60;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed/i.test(`${error.message} ${error.cause ?? ""}`)
  );
}

export const meRoutes = new Hono<AppEnv>()
  /** Returns { me: null } when signed out so the web app can branch without a 401. */
  .get("/me", (c) => c.json({ me: toMe(c.get("user")) }))

  .get("/handles/:handle", async (c) => {
    const handle = normalizeHandle(c.req.param("handle"));
    const problem = checkHandle(handle);
    if (problem) return c.json({ handle, available: false, problem });
    const taken = await findUserByHandle(getDb(c.env.DB), handle);
    return c.json({ handle, available: !taken, problem: taken ? "taken" : null });
  })

  .use("/me/*", requireUser)

  /** Claim the account's one handle and create its default "Inbox" hop. */
  .put("/me/handle", validate("json", claimHandleSchema), async (c) => {
    const user = currentUser(c);
    if (user.handle) return fail(c, 409, "handle_already_set", "Your handle is already set.");
    const input = c.req.valid("json");
    const handle = normalizeHandle(input.handle);
    const problem = checkHandle(handle);
    if (problem) return fail(c, 400, `handle_${problem}`, "That handle can't be used.");

    const db = getDb(c.env.DB);
    const hopId = newId("hop");
    const now = Date.now();
    try {
      await db.batch([
        db.insert(hops).values({
          id: hopId,
          ownerId: user.id,
          slug: DEFAULT_HOP_SLUG,
          title: DEFAULT_HOP_TITLE,
          createdAt: now,
        }),
        db
          .update(users)
          .set({ handle, activeHopId: hopId, color: input.color ?? user.color, updatedAt: now })
          .where(eq(users.id, user.id)),
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) return fail(c, 409, "handle_taken", "That handle is taken.");
      throw error;
    }
    return c.json({
      me: toMe({ ...user, handle, activeHopId: hopId, color: input.color ?? user.color }),
    });
  })

  /** Profile settings; for now just the page colour. */
  .patch("/me", requireUser, validate("json", updateProfileSchema), async (c) => {
    const user = currentUser(c);
    const { color } = c.req.valid("json");
    await getDb(c.env.DB)
      .update(users)
      .set({ color, updatedAt: Date.now() })
      .where(eq(users.id, user.id));
    return c.json({ me: toMe({ ...user, color }) });
  })

  .get("/me/hops", async (c) => {
    const user = currentUser(c);
    const rows = await getDb(c.env.DB)
      .select({
        id: hops.id,
        slug: hops.slug,
        title: hops.title,
        status: hops.status,
        createdAt: hops.createdAt,
        fileCount: sql<number>`count(${files.id})`,
        totalBytes: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(hops)
      .leftJoin(files, and(eq(files.hopId, hops.id), eq(files.status, "complete")))
      .where(eq(hops.ownerId, user.id))
      .groupBy(hops.id)
      .orderBy(desc(hops.createdAt));
    return c.json({ hops: rows satisfies HopSummary[] });
  })

  .post("/me/hops", validate("json", createHopSchema), async (c) => {
    const user = currentUser(c);
    if (!user.handle) return fail(c, 409, "handle_required", "Pick your handle first.");
    const input = c.req.valid("json");
    const slug = slugify(input.slug || input.title);
    if (!HOP_SLUG_PATTERN.test(slug))
      return fail(c, 400, "invalid_slug", "Pick a different link name.");

    const hop = {
      id: newId("hop"),
      ownerId: user.id,
      slug,
      title: input.title,
      createdAt: Date.now(),
    };
    try {
      await getDb(c.env.DB).insert(hops).values(hop);
    } catch (error) {
      if (isUniqueViolation(error))
        return fail(c, 409, "slug_taken", "You already have a Hop with that link.");
      throw error;
    }
    return c.json(
      { hop: { ...hop, status: "open", fileCount: 0, totalBytes: 0 } satisfies HopSummary },
      201,
    );
  })

  .patch("/me/hops/:hopId", validate("json", updateHopSchema), async (c) => {
    const user = currentUser(c);
    const changes = c.req.valid("json");
    if (Object.keys(changes).length === 0)
      return fail(c, 400, "invalid_request", "Nothing to update.");
    const updated = await getDb(c.env.DB)
      .update(hops)
      .set(changes)
      .where(and(eq(hops.id, c.req.param("hopId")), eq(hops.ownerId, user.id)))
      .returning()
      .get();
    if (!updated) return fail(c, 404, "not_found");
    return c.json({ ok: true });
  })

  /** Point onmyhop.com/<handle> at this hop. */
  .post("/me/hops/:hopId/activate", async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    const hop = await db
      .select({ id: hops.id })
      .from(hops)
      .where(and(eq(hops.id, c.req.param("hopId")), eq(hops.ownerId, user.id)))
      .get();
    if (!hop) return fail(c, 404, "not_found");
    await db
      .update(users)
      .set({ activeHopId: hop.id, updatedAt: Date.now() })
      .where(eq(users.id, user.id));
    return c.json({ ok: true });
  })

  .get(
    "/me/files",
    validate("query", z.object({ hopId: z.string().optional(), cursor: z.string().optional() })),
    async (c) => {
      const user = currentUser(c);
      const { hopId, cursor } = c.req.valid("query");
      const conditions = [eq(files.ownerId, user.id), eq(files.status, "complete")];
      if (hopId) conditions.push(eq(files.hopId, hopId));
      if (cursor) {
        const [at, id] = cursor.split(":");
        const createdAt = Number(at);
        if (!id || !Number.isFinite(createdAt)) return fail(c, 400, "invalid_cursor");
        const before = or(
          lt(files.createdAt, createdAt),
          and(eq(files.createdAt, createdAt), lt(files.id, id)),
        );
        if (before) conditions.push(before);
      }
      const rows = await getDb(c.env.DB)
        .select()
        .from(files)
        .where(and(...conditions))
        .orderBy(desc(files.createdAt), desc(files.id))
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      const last = page.at(-1);
      const result: InboxPage = {
        files: page.map(
          (f): InboxFile => ({
            id: f.id,
            hopId: f.hopId,
            name: f.originalName,
            mime: f.mime,
            size: f.size,
            hasThumbnail: Boolean(f.thumbKey),
            contributorName: f.contributorName,
            contributorVerified: f.contributorUserId !== null,
            note: f.note,
            createdAt: f.createdAt,
          }),
        ),
        nextCursor: rows.length > PAGE_SIZE && last ? `${last.createdAt}:${last.id}` : null,
      };
      return c.json(result);
    },
  )

  .get("/me/files/:fileId/url", async (c) => {
    const user = currentUser(c);
    const file = await getDb(c.env.DB)
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, c.req.param("fileId")),
          eq(files.ownerId, user.id),
          eq(files.status, "complete"),
        ),
      )
      .get();
    if (!file) return fail(c, 404, "not_found");
    const url = await presignGet(c.env, file.r2Key, {
      filename: file.originalName,
      mime: file.mime,
      download: c.req.query("download") === "1",
    });
    return c.json({ url });
  })

  /** Signed download links for many files at once (used where zipping isn't possible). */
  .post("/me/files/urls", validate("json", fileUrlsSchema), async (c) => {
    const user = currentUser(c);
    const { ids, download } = c.req.valid("json");
    const rows = await getDb(c.env.DB)
      .select()
      .from(files)
      .where(and(inArray(files.id, ids), eq(files.ownerId, user.id), eq(files.status, "complete")));
    const urls = await Promise.all(
      rows.map(async (f) => ({
        id: f.id,
        url: await presignGet(c.env, f.r2Key, { filename: f.originalName, mime: f.mime, download }),
      })),
    );
    return c.json({ urls });
  })

  .get("/me/files/:fileId/thumbnail", async (c) => {
    const user = currentUser(c);
    const file = await getDb(c.env.DB)
      .select({ thumbKey: files.thumbKey })
      .from(files)
      .where(and(eq(files.id, c.req.param("fileId")), eq(files.ownerId, user.id)))
      .get();
    if (!file?.thumbKey) return fail(c, 404, "not_found");
    const object = await c.env.BUCKET.get(file.thumbKey);
    if (!object) return fail(c, 404, "not_found");
    return new Response(object.body, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=86400, immutable",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  })

  .delete("/me/files/:fileId", async (c) => {
    const user = currentUser(c);
    const db = getDb(c.env.DB);
    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.id, c.req.param("fileId")), eq(files.ownerId, user.id)))
      .get();
    if (!file) return fail(c, 404, "not_found");
    await removeFile(c.env, db, file);
    return c.json({ ok: true });
  });
