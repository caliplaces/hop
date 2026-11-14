import { and, eq } from "drizzle-orm";
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

/**
 * Delete a file durably. The row is first marked "deleting" (which also stops
 * any further part signing, completion or thumbnail writes), then the objects
 * are removed, and only then the row. If R2 fails midway the row survives in
 * "deleting" and the cleanup cron retries it, so nothing is ever orphaned.
 */
export async function removeFile(env: Env, db: Db, file: FileRow) {
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
