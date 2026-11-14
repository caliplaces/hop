import { PENDING_UPLOAD_TTL_MS } from "@hop/shared";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { files, sessions } from "./db/schema";
import type { Env } from "./env";

const BATCH = 100;
/** Upper bound per run so one invocation stays well inside Worker limits. */
const MAX_BATCHES = 50;

/** Aborts uploads with no activity for a day, and deletes expired sessions. */
export async function cleanup(env: Env) {
  const db = getDb(env.DB);
  const cutoff = Date.now() - PENDING_UPLOAD_TTL_MS;
  let removed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const stale = await db
      .select()
      .from(files)
      .where(and(eq(files.status, "pending"), lt(files.lastActivityAt, cutoff)))
      .limit(BATCH);
    if (stale.length === 0) break;

    await Promise.all(
      stale.map(async (file) => {
        if (file.multipartUploadId) {
          await env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId)
            .abort()
            .catch(() => {});
        }
        await env.BUCKET.delete([file.r2Key, ...(file.thumbKey ? [file.thumbKey] : [])]);
        await db.delete(files).where(eq(files.id, file.id));
      }),
    );
    removed += stale.length;
  }

  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  console.log(`cleanup: removed ${removed} abandoned uploads`);
}
