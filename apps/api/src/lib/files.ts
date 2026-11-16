import { and, eq, ne, sql } from "drizzle-orm";
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
 *
 * A clip held for a report is only hidden ("held"), and the cleanup removes
 * it when the hold ends. Checking the hold and claiming the row is one
 * statement, and a report only holds a clip that isn't "deleting", so a clip
 * is either held or going, never both.
 */
export async function removeFile(env: Env, db: Db, file: FileRow) {
  const now = Date.now();
  const claimed = await db
    .update(files)
    .set({ status: goneStatus(now), lastActivityAt: now })
    .where(and(eq(files.id, file.id), ne(files.status, "held")))
    .returning({ status: files.status })
    .get();
  if (claimed?.status !== "deleting") return;
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
