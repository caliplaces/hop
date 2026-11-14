import {
  type CreateUploadResult,
  completeUploadSchema,
  createUploadSchema,
  DEFAULT_STORAGE_QUOTA_BYTES,
  hopPassSchema,
  isAllowedMime,
  MAX_THUMBNAIL_BYTES,
  PART_BYTES,
  PENDING_UPLOAD_TTL_MS,
  partCount,
  randomContributorName,
  type SignedPart,
  signPartsSchema,
} from "@hop/shared";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { getDb } from "../db";
import { type FileRow, files, hops } from "../db/schema";
import type { AppEnv, Env } from "../env";
import { newId, randomToken, sha256Hex, signPayload, verifyPayload } from "../lib/crypto";
import { clientIp, fail } from "../lib/http";
import { SNIFF_BYTES, sniffMedia } from "../lib/sniff";
import { normalizeEtag, presignUploadPart } from "../lib/storage";
import { verifyTurnstile } from "../lib/turnstile";
import { validate } from "../lib/validate";

/** A pass proves the contributor solved Turnstile for this hop recently. */
type HopPass = { purpose: "hop-pass"; exp: number; hopId: string };
const HOP_PASS_TTL_MS = 2 * 60 * 60 * 1000;
/** Thumbnails can still be attached shortly after the upload completes. */
const THUMBNAIL_GRACE_MS = 60 * 60 * 1000;

async function rateLimited(env: Env, key: string): Promise<boolean> {
  const { success } = await env.UPLOAD_LIMITER.limit({ key });
  return !success;
}

/** Bytes an owner has stored, plus in-flight uploads so parallel uploads can't overshoot. */
async function usedBytes(db: ReturnType<typeof getDb>, ownerId: string): Promise<number> {
  const row = await db
    .select({ total: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(
      and(
        eq(files.ownerId, ownerId),
        or(eq(files.status, "complete"), gt(files.createdAt, Date.now() - PENDING_UPLOAD_TTL_MS)),
      ),
    )
    .get();
  return Number(row?.total ?? 0);
}

/** Resolves the file an upload token (Authorization: Bearer) grants access to. */
async function authorizeUpload(c: Context<AppEnv>): Promise<FileRow | null> {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const file = await getDb(c.env.DB)
    .select()
    .from(files)
    .where(eq(files.id, c.req.param("fileId") ?? ""))
    .get();
  if (!file || file.uploadTokenHash !== (await sha256Hex(token))) return null;
  return file;
}

export const uploadRoutes = new Hono<AppEnv>()
  .post("/hops/:hopId/pass", validate("json", hopPassSchema), async (c) => {
    const ip = clientIp(c);
    if (await rateLimited(c.env, `pass:${ip}`)) {
      return fail(c, 429, "rate_limited", "Too many attempts. Try again in a minute.");
    }
    const hopId = c.req.param("hopId");
    const hop = await getDb(c.env.DB).select().from(hops).where(eq(hops.id, hopId)).get();
    if (!hop) return fail(c, 404, "not_found");
    if (hop.status !== "open")
      return fail(c, 403, "hop_closed", "This Hop isn't accepting uploads.");

    if (!(await verifyTurnstile(c.env, c.req.valid("json").turnstileToken, ip))) {
      return fail(c, 403, "turnstile_failed", "We couldn't verify you're human. Please try again.");
    }
    const exp = Date.now() + HOP_PASS_TTL_MS;
    const pass = await signPayload<HopPass>(c.env.SESSION_SECRET, {
      purpose: "hop-pass",
      exp,
      hopId,
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
    if (await rateLimited(c.env, `upload:${ip}`)) {
      return fail(c, 429, "rate_limited", "Slow down a little, then try again.");
    }

    const input = c.req.valid("json");
    if (!isAllowedMime(input.type)) {
      return fail(c, 415, "unsupported_type", "Only videos and photos can be uploaded.");
    }

    const db = getDb(c.env.DB);
    const hop = await db.select().from(hops).where(eq(hops.id, hopId)).get();
    if (!hop) return fail(c, 404, "not_found");
    if (hop.status !== "open")
      return fail(c, 403, "hop_closed", "This Hop isn't accepting uploads.");

    if ((await usedBytes(db, hop.ownerId)) + input.size > DEFAULT_STORAGE_QUOTA_BYTES) {
      return fail(c, 507, "hop_full", "This Hop is full right now.");
    }

    const user = c.get("user");
    const contributorName = user
      ? user.handle
        ? `@${user.handle}`
        : (user.name ?? randomContributorName())
      : (input.contributorName ?? randomContributorName());

    const fileId = newId("fil");
    const r2Key = `hops/${hop.id}/${fileId}/original`;
    const multipart = await c.env.BUCKET.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: input.type },
      customMetadata: { fileId },
    });

    const uploadToken = randomToken();
    const parts = partCount(input.size);
    await db.insert(files).values({
      id: fileId,
      hopId: hop.id,
      ownerId: hop.ownerId,
      r2Key,
      originalName: input.name,
      mime: input.type,
      size: input.size,
      partSize: PART_BYTES,
      partCount: parts,
      multipartUploadId: multipart.uploadId,
      uploadTokenHash: await sha256Hex(uploadToken),
      contributorName,
      contributorUserId: user?.id ?? null,
      note: input.note || null,
      uploaderIpHash: await sha256Hex(`${c.env.SESSION_SECRET}:${ip}`),
      createdAt: Date.now(),
    });

    return c.json<CreateUploadResult>(
      { fileId, uploadToken, partSize: PART_BYTES, partCount: parts },
      201,
    );
  })

  .post("/uploads/:fileId/parts", validate("json", signPartsSchema), async (c) => {
    const file = await authorizeUpload(c);
    if (file?.status !== "pending" || !file.multipartUploadId) return fail(c, 404, "not_found");
    const { partNumbers } = c.req.valid("json");
    if (partNumbers.some((n) => n > file.partCount)) return fail(c, 400, "invalid_part");

    const uploadId = file.multipartUploadId;
    const parts: SignedPart[] = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await presignUploadPart(c.env, file.r2Key, uploadId, partNumber),
      })),
    );
    return c.json({ parts });
  })

  .post("/uploads/:fileId/complete", validate("json", completeUploadSchema), async (c) => {
    const file = await authorizeUpload(c);
    if (!file?.multipartUploadId) return fail(c, 404, "not_found");
    if (file.status === "complete") return c.json({ ok: true });

    const parts = [...c.req.valid("json").parts].sort((a, b) => a.partNumber - b.partNumber);
    const expected =
      parts.length === file.partCount && parts.every((p, i) => p.partNumber === i + 1);
    if (!expected) return fail(c, 400, "missing_parts", "Some parts of the file are missing.");

    const db = getDb(c.env.DB);
    const multipart = c.env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId);
    const object = await multipart.complete(
      parts.map((p) => ({ partNumber: p.partNumber, etag: normalizeEtag(p.etag) })),
    );

    const reject = async (status: 400 | 415, error: string, message: string) => {
      await c.env.BUCKET.delete(file.r2Key);
      if (file.thumbKey) await c.env.BUCKET.delete(file.thumbKey);
      await db.delete(files).where(eq(files.id, file.id));
      return fail(c, status, error, message);
    };

    if (object.size !== file.size) {
      return reject(400, "size_mismatch", "The uploaded file doesn't match its declared size.");
    }
    const head = await c.env.BUCKET.get(file.r2Key, { range: { offset: 0, length: SNIFF_BYTES } });
    const kind = head ? sniffMedia(new Uint8Array(await head.arrayBuffer())) : null;
    if (!kind)
      return reject(415, "unsupported_type", "That file doesn't look like a video or photo.");

    await db
      .update(files)
      .set({ status: "complete", completedAt: Date.now(), multipartUploadId: null })
      .where(eq(files.id, file.id));
    return c.json({ ok: true });
  })

  .put("/uploads/:fileId/thumbnail", async (c) => {
    const file = await authorizeUpload(c);
    if (!file) return fail(c, 404, "not_found");
    const lateThumbnail =
      file.status === "complete" && (file.completedAt ?? 0) < Date.now() - THUMBNAIL_GRACE_MS;
    if (lateThumbnail) return fail(c, 409, "too_late");
    if (c.req.header("content-type") !== "image/jpeg") return fail(c, 415, "unsupported_type");

    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_THUMBNAIL_BYTES) {
      return fail(c, 413, "too_large");
    }
    if (sniffMedia(new Uint8Array(body.slice(0, SNIFF_BYTES))) !== "image") {
      return fail(c, 415, "unsupported_type");
    }
    const thumbKey = `hops/${file.hopId}/${file.id}/thumb.jpg`;
    await c.env.BUCKET.put(thumbKey, body, { httpMetadata: { contentType: "image/jpeg" } });
    await getDb(c.env.DB).update(files).set({ thumbKey }).where(eq(files.id, file.id));
    return c.json({ ok: true });
  })

  /** Contributor cancelled before completing. */
  .delete("/uploads/:fileId", async (c) => {
    const file = await authorizeUpload(c);
    if (file?.status !== "pending") return fail(c, 404, "not_found");
    if (file.multipartUploadId) {
      await c.env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId)
        .abort()
        .catch(() => {});
    }
    if (file.thumbKey) await c.env.BUCKET.delete(file.thumbKey);
    await getDb(c.env.DB).delete(files).where(eq(files.id, file.id));
    return c.json({ ok: true });
  });
