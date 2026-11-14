import { PENDING_UPLOAD_TTL_MS } from "@hop/shared";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { files, sessions } from "./db/schema";
import type { Env } from "./env";

/** Clears out uploads that were started but never completed, and expired sessions. */
export async function cleanup(env: Env) {
  const db = getDb(env.DB);
  const cutoff = Date.now() - PENDING_UPLOAD_TTL_MS;

  const stale = await db
    .select()
    .from(files)
    .where(and(eq(files.status, "pending"), lt(files.createdAt, cutoff)))
    .limit(200);

  for (const file of stale) {
    if (file.multipartUploadId) {
      await env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId)
        .abort()
        .catch(() => {});
    }
    await env.BUCKET.delete([file.r2Key, ...(file.thumbKey ? [file.thumbKey] : [])]);
    await db.delete(files).where(eq(files.id, file.id));
  }

  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  console.log(`cleanup: removed ${stale.length} abandoned uploads`);
}
