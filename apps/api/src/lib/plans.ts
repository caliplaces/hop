import { PLANS } from "@hop/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { subscriptions } from "../db/schema";

/** SQL: until when a subscription gives Hop+, counting a billing grace period. */
const endsSql = () =>
  sql`max(${subscriptions.expiresAt}, coalesce(${subscriptions.graceExpiresAt}, 0))`;

/** SQL: whether this athlete has Hop+ at `now` (a live, unrevoked subscription). */
export function hasPlusSql(userId: string, now: number) {
  return sql`exists (
    select 1 from ${subscriptions}
    where ${subscriptions.userId} = ${userId}
      and ${endsSql()} > ${now}
      and ${subscriptions.revokedAt} is null
  )`;
}

/** SQL: this athlete's storage limit in bytes at `now`, for the quota checks. */
export function storageLimitSql(userId: string, now: number) {
  return sql`(case when ${hasPlusSql(userId, now)}
    then ${PLANS.plus.storageBytes} else ${PLANS.free.storageBytes} end)`;
}

/** The athlete's live Hop+ subscription, if they have one: the one running longest. */
export async function activeSubscription(db: Db, userId: string, now = Date.now()) {
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        sql`${endsSql()} > ${now}`,
        isNull(subscriptions.revokedAt),
      ),
    )
    .orderBy(sql`${endsSql()} desc`)
    .get();
}
