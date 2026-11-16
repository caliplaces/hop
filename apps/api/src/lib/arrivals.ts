import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db";
import { files } from "../db/schema";

/**
 * Clips that finished uploading into a hop since `since` (ms, server clock):
 * how many, and the newest `latest` of them, newest first. Counting by
 * completion means an upload started earlier still counts when it lands, and
 * deleting older clips changes nothing. One indexed range
 * (files_hop_status_completed_idx).
 */
export async function arrivalsSince(db: Db, hopId: string, since: number, latest: number) {
  const arrived = and(
    eq(files.hopId, hopId),
    eq(files.status, "complete"),
    gte(files.completedAt, since),
  );
  const [total, rows] = await db.batch([
    db.select({ count: sql<number>`count(*)` }).from(files).where(arrived),
    db
      .select()
      .from(files)
      .where(arrived)
      .orderBy(desc(files.completedAt), desc(files.id))
      .limit(latest),
  ]);
  return { count: total[0]?.count ?? 0, latest: rows };
}
