import { PENDING_UPLOAD_TTL_MS } from "@hop/shared";
import { and, eq, lt, or } from "drizzle-orm";
import { getDb } from "./db";
import { files, sessions } from "./db/schema";
import type { Env } from "./env";
import { finishRemoval } from "./lib/files";

const BATCH = 100;
/** Upper bound per run so one invocation stays well inside Worker limits. */
const MAX_BATCHES = 50;
/** A removal still "deleting" after this long failed midway and is retried. */
const STUCK_DELETE_MS = 10 * 60 * 1000;

/**
 * Removes uploads with no activity for a day, retries removals that failed
 * midway, and deletes expired sessions.
 */
export async function cleanup(env: Env) {
  const db = getDb(env.DB);
  let removed = 0;
  let failed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const now = Date.now();
    const due = or(
      and(eq(files.status, "pending"), lt(files.lastActivityAt, now - PENDING_UPLOAD_TTL_MS)),
      and(eq(files.status, "deleting"), lt(files.lastActivityAt, now - STUCK_DELETE_MS)),
    );
    const candidates = await db.select({ id: files.id }).from(files).where(due).limit(BATCH);
    if (candidates.length === 0) break;

    const outcomes = await Promise.allSettled(
      candidates.map(async ({ id }) => {
        // Claim atomically. If the upload completed since it was read, the
        // conditions no longer match and it's left alone. Bumping the activity
        // time keeps a failing removal from being retried again in this run.
        const file = await db
          .update(files)
          .set({ status: "deleting", lastActivityAt: Date.now() })
          .where(and(eq(files.id, id), due))
          .returning()
          .get();
        if (!file) return false;
        await finishRemoval(env, db, file);
        return true;
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        failed++;
        console.error("cleanup: removal failed, will retry", outcome.reason);
      } else if (outcome.value) {
        removed++;
      }
    }
  }

  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  console.log(`cleanup: removed ${removed} uploads, ${failed} failed`);
}
