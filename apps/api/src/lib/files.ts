import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db";
import { type FileRow, files } from "../db/schema";
import type { Env } from "../env";

export function originalKey(hopId: string, fileId: string): string {
  return `hops/${hopId}/${fileId}/original`;
}

/** Deterministic, so deletes can remove a thumbnail even if the row never recorded it. */
export function thumbnailKey(file: Pick<FileRow, "hopId" | "id">): string {
  return `hops/${file.hopId}/${file.id}/thumb.jpg`;
}

/** How long a reported clip is kept for Hop's team, even once deleted. */
export const HOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * SQL: what deleting a clip makes it, for statements that delete many: kept
 * out of sight while it's held for a report, otherwise "deleting", which the
 * cleanup removes.
 */
export const goneStatus = (now: number) =>
  sql<"held" | "deleting">`case when ${files.heldUntil} > ${now} then 'held' else 'deleting' end`;

/**
 * Delete a file durably. The row is first marked "deleting" (which also stops
 * any further part signing, completion or thumbnail writes), then the objects
 * are removed, and only then the row. If R2 fails midway the row survives in
 * "deleting" and the cleanup cron retries it, so nothing is ever orphaned.
 */
export async function removeFile(env: Env, db: Db, file: FileRow) {
  // A reported clip stays for Hop's team, out of the athlete's sight, until
  // its hold ends; the cleanup removes it then.
  const held = await db
    .update(files)
    .set({ status: "held" })
    .where(and(eq(files.id, file.id), gt(files.heldUntil, Date.now())))
    .returning({ id: files.id })
    .get();
  if (held) return;
  await db
    .update(files)
    .set({ status: "deleting", lastActivityAt: Date.now() })
    .where(eq(files.id, file.id));
  await finishRemoval(env, db, file);
}

/** Second half of removeFile, for rows already marked "deleting". */
export async function finishRemoval(env: Env, db: Db, file: FileRow) {
  if (file.multipartUploadId) {
    await env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId)
      .abort()
      .catch(() => {}); // already completed or aborted
  }
  await env.BUCKET.delete([file.r2Key, thumbnailKey(file)]);
  await db.delete(files).where(and(eq(files.id, file.id), eq(files.status, "deleting")));
}
