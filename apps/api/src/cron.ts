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

    const claimed = await Promise.all(
      stale.map(async (candidate) => {
        // Claim the row first, atomically: if the upload completed since it was
        // read, the conditions no longer match and its files are left alone.
        const file = await db
          .delete(files)
          .where(
            and(
              eq(files.id, candidate.id),
              eq(files.status, "pending"),
              lt(files.lastActivityAt, cutoff),
            ),
          )
          .returning()
          .get();
        if (!file) return 0;
        if (file.multipartUploadId) {
          await env.BUCKET.resumeMultipartUpload(file.r2Key, file.multipartUploadId)
            .abort()
            .catch(() => {});
        }
        await env.BUCKET.delete([file.r2Key, ...(file.thumbKey ? [file.thumbKey] : [])]);
        return 1;
      }),
    );
    removed += claimed.reduce<number>((sum, n) => sum + n, 0);
  }

  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  console.log(`cleanup: removed ${removed} abandoned uploads`);
}
