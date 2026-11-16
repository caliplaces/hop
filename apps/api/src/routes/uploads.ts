import {
  type CreateUploadResult,
  completeUploadSchema,
  createUploadSchema,
  hopPassSchema,
  isAcceptableDeclaredType,
  MAX_ACTIVE_UPLOADS_PER_PASS,
  MAX_THUMBNAIL_BYTES,
  MAX_UPLOADS_PER_PASS,
  PART_BYTES,
  PENDING_RESERVATION_MS,
  partCount,
  partLength,
  randomContributorName,
  type SignedPart,
  signPartsSchema,
  withMediaExtension,
} from "@hop/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { type Db, getDb } from "../db";
import { type FileRow, files, hops } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { newId, randomToken, sha256Hex, signPayload, verifyPayload } from "../lib/crypto";
import { originalKey, removeFile, thumbnailKey } from "../lib/files";
import { BodyTooLargeError, clientIp, fail, readBodyCapped } from "../lib/http";
import { storageLimitSql } from "../lib/plans";
import { blockedSql, isBlocked, senderKey } from "../lib/senders";
import { SNIFF_BYTES, sniffMedia } from "../lib/sniff";
import { normalizeEtag, presignUploadPart } from "../lib/storage";
import { verifyTurnstile } from "../lib/turnstile";
import { validate } from "../lib/validate";
import { pushArrivals } from "../live";

/** What a blocked sender hears: plainly, without saying who or why. */
const BLOCKED_MESSAGE = "You can't send clips to this Hop.";

/** A pass proves the contributor solved Turnstile for this hop recently. */
type HopPass = { purpose: "hop-pass"; exp: number; hopId: string; passId: string };
const HOP_PASS_TTL_MS = 2 * 60 * 60 * 1000;
/** Thumbnails can still be attached shortly after the upload completes. */
const THUMBNAIL_GRACE_MS = 60 * 60 * 1000;

async function rateLimited(env: Env, key: string): Promise<boolean> {
  const { success } = await env.UPLOAD_LIMITER.limit({ key });
  return !success;
}

/** Resolves the file an upload token (Authorization: Bearer) grants access to. */
async function authorizeUpload(c: Context<AppEnv>, db: Db): Promise<FileRow | null> {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const fileId = c.req.param("fileId");
  if (!token || !fileId) return null;
  const file = await db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file || file.uploadTokenHash !== (await sha256Hex(token))) return null;
  return file;
}

/**
 * Keep (or re-take) a pending upload's quota reservation, atomically. A live
 * reservation is just refreshed. One that lapsed after an hour of inactivity
 * only comes back if the owner's quota still has room, so an old upload token
 * can't be used to slip past the quota later. False means the Hop is full or
 * the upload is no longer pending.
 */
async function holdReservation(db: Db, file: FileRow): Promise<boolean> {
  const now = Date.now();
  const activeSince = now - PENDING_RESERVATION_MS;
  const result = await db.run(sql`
    update ${files} set last_activity_at = ${now}
    where id = ${file.id} and status = 'pending' and (
      last_activity_at > ${activeSince}
      or (
        select coalesce(sum(size), 0) from ${files}
        where owner_id = ${file.ownerId} and id != ${file.id}
          and (status = 'complete' or (status = 'pending' and last_activity_at > ${activeSince}))
      ) + ${file.size} <= ${storageLimitSql(file.ownerId, now)}
    )
  `);
  return result.meta.changes === 1;
}

export const uploadRoutes = new Hono<AppEnv>()
  .post("/hops/:hopId/pass", validate("json", hopPassSchema), async (c) => {
    const ip = clientIp(c);
    if (await rateLimited(c.env, `pass:${ip}`)) {
      return fail(c, 429, "rate_limited", "Too many attempts. Try again in a minute.");
    }
    const hopId = c.req.param("hopId");
    const db = getDb(c.env.DB);
    const hop = await db.select().from(hops).where(eq(hops.id, hopId)).get();
    if (!hop) return fail(c, 404, "not_found");
    if (hop.status !== "open")
      return fail(c, 403, "hop_closed", "This Hop isn't accepting uploads.");
    // Before the challenge, so a blocked sender hears it before solving one.
    // Uploads check again: this is only the early word.
    const sender = await senderKey(c);
    if (await isBlocked(db, hop.ownerId, sender, c.get("user")?.id ?? null)) {
      return fail(c, 403, "blocked", BLOCKED_MESSAGE);
    }

    if (!(await verifyTurnstile(c.env, c.req.valid("json").turnstileToken, ip, "upload"))) {
      return fail(c, 403, "turnstile_failed", "We couldn't verify you're human. Please try again.");
    }
    const exp = Date.now() + HOP_PASS_TTL_MS;
    const pass = await signPayload<HopPass>(c.env.SESSION_SECRET, {
      purpose: "hop-pass",
      exp,
      hopId,
      passId: randomToken(12),
    });
    return c.json({ pass, expiresAt: exp });
  })

  .post("/hops/:hopId/uploads", validate("json", createUploadSchema), async (c) => {
    const hopId = c.req.param("hopId");
    const pass = await verifyPayload<HopPass>(
      c.env.SESSION_SECRET,
      c.req.header("x-hop-pass"),
      "hop-pass",
    );
    if (!pass || pass.hopId !== hopId) return fail(c, 403, "pass_required");

    const ip = clientIp(c);
    if (
      (await rateLimited(c.env, `upload:${ip}`)) ||
      (await rateLimited(c.env, `upload-hop:${hopId}`))
    ) {
      return fail(c, 429, "rate_limited", "Slow down a little, then try again.");
    }

    const input = c.req.valid("json");
    if (!isAcceptableDeclaredType(input.type)) {
      return fail(c, 415, "unsupported_type", "Only videos and photos can be uploaded.");
    }

    const db = getDb(c.env.DB);
    const hop = await db.select().from(hops).where(eq(hops.id, hopId)).get();
    if (!hop) return fail(c, 404, "not_found");
    if (hop.status !== "open")
      return fail(c, 403, "hop_closed", "This Hop isn't accepting uploads.");

    const now = Date.now();
    const activeSince = now - PENDING_RESERVATION_MS;

    // Soft per-pass limits: one solved challenge can't open unlimited uploads.
    const passUsage = await db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${files.status} = 'pending' and ${files.lastActivityAt} > ${activeSince} then 1 else 0 end)`,
      })
      .from(files)
      .where(eq(files.passId, pass.passId))
      .get();
    if (
      Number(passUsage?.total ?? 0) >= MAX_UPLOADS_PER_PASS ||
      Number(passUsage?.active ?? 0) >= MAX_ACTIVE_UPLOADS_PER_PASS
    ) {
      return fail(c, 429, "too_many_uploads", "Let the current uploads finish first.");
    }

    // Signed-in contributors are credited by their verified handle; anonymous
    // names can't start with "@" (enforced by the schema).
    const user = c.get("user");
    const contributorName = user
      ? user.handle
        ? `@${user.handle}`
        : (user.name ?? randomContributorName())
      : (input.contributorName ?? randomContributorName());

    const sender = await senderKey(c);
    const fileId = newId("fil");
    const r2Key = originalKey(hop.id, fileId);
    const uploadToken = randomToken();
    const parts = partCount(input.size);

    // Reserve quota atomically: the row is only inserted if the owner's stored
    // bytes plus actively uploading bytes still fit.
    const reserved = await db.run(sql`
      insert into ${files} (
        id, hop_id, owner_id, r2_key, original_name, mime, size, part_size, part_count,
        status, pass_id, upload_token_hash, contributor_name, contributor_user_id, note,
        uploader_ip_hash, sender_key, created_at, last_activity_at
      )
      select
        ${fileId}, ${hop.id}, ${hop.ownerId}, ${r2Key}, ${input.name},
        ${input.type || "application/octet-stream"}, ${input.size}, ${PART_BYTES}, ${parts},
        'pending', ${pass.passId}, ${await sha256Hex(uploadToken)}, ${contributorName},
        ${user?.id ?? null}, ${input.note || null}, ${await sha256Hex(`${c.env.SESSION_SECRET}:${ip}`)},
        ${sender}, ${now}, ${now}
      where (
        select coalesce(sum(size), 0) from ${files}
        where owner_id = ${hop.ownerId}
          and (status = 'complete' or (status = 'pending' and last_activity_at > ${activeSince}))
      ) + ${input.size} <= ${storageLimitSql(hop.ownerId, now)}
        -- Still open: closed, or its owner's account deleted, since it was read.
        and (select status from ${hops} where id = ${hop.id}) = 'open'
        -- And not from someone the owner blocked.
        and not ${blockedSql(hop.ownerId, sender, user?.id ?? null)}
    `);
    if (reserved.meta.changes !== 1) {
      if (await isBlocked(db, hop.ownerId, sender, user?.id ?? null)) {
        return fail(c, 403, "blocked", BLOCKED_MESSAGE);
      }
      const still = await db
        .select({ status: hops.status })
        .from(hops)
        .where(eq(hops.id, hop.id))
        .get();
      if (still?.status !== "open") {
        return fail(c, 403, "hop_closed", "This Hop isn't accepting uploads.");
      }
      return fail(c, 507, "hop_full", "This Hop is full right now.");
    }

    try {
      const multipart = await c.env.BUCKET.createMultipartUpload(r2Key, {
        customMetadata: { fileId },
      });
      await db
        .update(files)
        .set({ multipartUploadId: multipart.uploadId })
        .where(eq(files.id, fileId));
    } catch (error) {
      await db.delete(files).where(eq(files.id, fileId));
      throw error;
    }

    return c.json<CreateUploadResult>(
      { fileId, uploadToken, partSize: PART_BYTES, partCount: parts },
      201,
    );
  })

  .post("/uploads/:fileId/parts", validate("json", signPartsSchema), async (c) => {
    const db = getDb(c.env.DB);
    const file = await authorizeUpload(c, db);
    if (file?.status !== "pending" || !file.multipartUploadId) return fail(c, 404, "not_found");
    const { partNumbers } = c.req.valid("json");
    if (partNumbers.some((n) => n > file.partCount)) return fail(c, 400, "invalid_part");
    if (!(await holdReservation(db, file))) {
      return fail(c, 507, "hop_full", "This Hop is full right now.");
    }

    // Uploads already in flight may finish after a Hop is closed; closing only
    // stops new uploads from starting.
    const uploadId = file.multipartUploadId;
    const parts: SignedPart[] = await Promise.all(
      [...new Set(partNumbers)].map(async (partNumber) => ({
        partNumber,
        url: await presignUploadPart(
          c.env,
          file.r2Key,
          uploadId,
          partNumber,
          partLength(file.size, partNumber, file.partSize),
        ),
      })),
    );
    return c.json({ parts });
  })

  .post("/uploads/:fileId/complete", validate("json", completeUploadSchema), async (c) => {
    const db = getDb(c.env.DB);
    const file = await authorizeUpload(c, db);
    if (!file) return fail(c, 404, "not_found");
    // Idempotent: a retry after a lost response must not look like a failure.
    if (file.status === "complete") return c.json({ ok: true });
    if (file.status !== "pending" || !file.multipartUploadId) return fail(c, 404, "not_found");

    const parts = [...c.req.valid("json").parts].sort((a, b) => a.partNumber - b.partNumber);
    const expected =
      parts.length === file.partCount && parts.every((p, i) => p.partNumber === i + 1);
    if (!expected) return fail(c, 400, "missing_parts", "Some parts of the file are missing.");

    if (!(await holdReservation(db, file))) {
      return fail(c, 507, "hop_full", "This Hop is full right now.");
    }

    const multipart = c.env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId);
    const object = await multipart.complete(
      parts.map((p) => ({ partNumber: p.partNumber, etag: normalizeEtag(p.etag) })),
    );
    const completed = { ...file, multipartUploadId: null };

    if (object.size !== file.size) {
      await removeFile(c.env, db, completed);
      return fail(c, 400, "size_mismatch", "The uploaded file doesn't match its declared size.");
    }
    const head = await c.env.BUCKET.get(file.r2Key, { range: { offset: 0, length: SNIFF_BYTES } });
    const mime = head ? sniffMedia(new Uint8Array(await head.arrayBuffer()), object.size) : null;
    if (!mime) {
      await removeFile(c.env, db, completed);
      return fail(c, 415, "unsupported_type", "That file doesn't look like a video or photo.");
    }

    // The stored type and extension come from the bytes, never from the client.
    const now = Date.now();
    const finished = await db
      .update(files)
      .set({
        status: "complete",
        mime,
        originalName: withMediaExtension(file.originalName, mime),
        completedAt: now,
        lastActivityAt: now,
        multipartUploadId: null,
      })
      .where(and(eq(files.id, file.id), eq(files.status, "pending")))
      .returning({ id: files.id })
      .get();
    if (!finished) {
      // Cleanup claimed this upload while it was completing; don't leave the object behind.
      await c.env.BUCKET.delete(file.r2Key);
      return fail(c, 410, "upload_expired", "This upload expired. Please upload the file again.");
    }
    // After the response: the athlete's Live Activity counts the new clip.
    c.executionCtx.waitUntil(
      pushArrivals(c.env, file.hopId).catch((error) =>
        console.error("live activity: update failed", error),
      ),
    );
    return c.json({ ok: true });
  })

  .put("/uploads/:fileId/thumbnail", async (c) => {
    const db = getDb(c.env.DB);
    const file = await authorizeUpload(c, db);
    if (!file || file.status === "deleting") return fail(c, 404, "not_found");
    const lateThumbnail =
      file.status === "complete" && (file.completedAt ?? 0) < Date.now() - THUMBNAIL_GRACE_MS;
    if (lateThumbnail) return fail(c, 409, "too_late");
    if (c.req.header("content-type") !== "image/jpeg") return fail(c, 415, "unsupported_type");

    let body: Uint8Array;
    try {
      body = await readBodyCapped(c.req.raw, MAX_THUMBNAIL_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return fail(c, 413, "too_large");
      throw error;
    }
    if (sniffMedia(body.subarray(0, SNIFF_BYTES), body.byteLength) !== "image/jpeg") {
      return fail(c, 415, "unsupported_type");
    }
    const thumbKey = thumbnailKey(file);
    await c.env.BUCKET.put(thumbKey, body, { httpMetadata: { contentType: "image/jpeg" } });
    const attached = await db
      .update(files)
      .set({ thumbKey })
      .where(and(eq(files.id, file.id), inArray(files.status, ["pending", "complete"])))
      .returning({ id: files.id })
      .get();
    if (!attached) {
      // The upload was cancelled or cleaned up while the thumbnail was being written.
      await c.env.BUCKET.delete(thumbKey);
      return fail(c, 404, "not_found");
    }
    return c.json({ ok: true });
  })

  /** Contributor cancelled before completing. */
  .delete("/uploads/:fileId", async (c) => {
    const db = getDb(c.env.DB);
    const file = await authorizeUpload(c, db);
    if (file?.status !== "pending") return fail(c, 404, "not_found");
    await removeFile(c.env, db, file);
    return c.json({ ok: true });
  });
