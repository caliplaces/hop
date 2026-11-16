import { type AdminStats, DEFAULT_HOP_SLUG, type Recent } from "@hop/shared";
import { sql } from "drizzle-orm";
import type { Db } from "./db";
import { files, hops, sessions, users, waitlist } from "./db/schema";
import { hasPlusSql } from "./lib/plans";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = { day: 1, week: 7, month: 30 } as const;
/** How long each kind of session lasts from its last renewal (lib/session.ts). */
const SESSION_TTL_MS = { app: 90 * DAY_MS, web: 30 * DAY_MS };

/**
 * Hop's numbers for the private stats page: counts and sums over what the
 * API stores anyway, nothing about anyone in particular, and nothing new
 * collected. Read on demand, by Hop's team only (routes/admin.ts).
 *
 * "Active" athletes used the app, or the website's session was renewed or
 * started, in the window. App sessions renew at most daily, so the app's
 * count is right to the day; the website's is a lower bound (its sessions
 * renew in their last week).
 */
export async function adminStats(db: Db, now = Date.now()): Promise<AdminStats> {
  const since = (days: number) => now - days * DAY_MS;
  const recent = async (count: (since: number) => Promise<number>): Promise<Recent> => ({
    day: await count(since(WINDOWS.day)),
    week: await count(since(WINDOWS.week)),
    month: await count(since(WINDOWS.month)),
  });
  const one = async (query: ReturnType<typeof sql>) =>
    Number((await db.get<{ n: number | null }>(query))?.n ?? 0);

  const athlete = sql`${users.handle} is not null and ${users.deletedAt} is null`;
  const kept = sql`${files.status} in ('complete', 'held')`;
  const event = sql`${hops.slug} != ${DEFAULT_HOP_SLUG}`;
  const lastSeen = sql`(${sessions.expiresAt} - case ${sessions.kind} when 'app' then ${SESSION_TTL_MS.app} else ${SESSION_TTL_MS.web} end)`;

  const firstDay = Math.floor(since(WINDOWS.month - 1) / DAY_MS) * DAY_MS;
  const perDay = async (query: ReturnType<typeof sql>) =>
    new Map(
      (await db.all<{ day: number; n: number; bytes?: number }>(query)).map((row) => [
        Number(row.day),
        row,
      ]),
    );
  const newAthletes = await perDay(sql`
    select cast(${users.createdAt} / ${DAY_MS} as integer) as day, count(*) as n from ${users}
    where ${athlete} and ${users.createdAt} >= ${firstDay} group by day`);
  const newEvents = await perDay(sql`
    select cast(${hops.createdAt} / ${DAY_MS} as integer) as day, count(*) as n from ${hops}
    where ${event} and ${hops.createdAt} >= ${firstDay} group by day`);
  const newClips = await perDay(sql`
    select cast(${files.completedAt} / ${DAY_MS} as integer) as day, count(*) as n, sum(${files.size}) as bytes
    from ${files} where ${kept} and ${files.completedAt} >= ${firstDay} group by day`);
  const daily = Array.from({ length: WINDOWS.month }, (_, i) => {
    const day = firstDay / DAY_MS + i;
    return {
      day: new Date(day * DAY_MS).toISOString().slice(0, 10),
      athletes: Number(newAthletes.get(day)?.n ?? 0),
      events: Number(newEvents.get(day)?.n ?? 0),
      clips: Number(newClips.get(day)?.n ?? 0),
      bytes: Number(newClips.get(day)?.bytes ?? 0),
    };
  });

  const ownerHasPlus = hasPlusSql(files.ownerId, now);
  return {
    generatedAt: now,
    athletes: {
      total: await one(sql`select count(*) as n from ${users} where ${athlete}`),
      new: await recent((from) =>
        one(
          sql`select count(*) as n from ${users} where ${athlete} and ${users.createdAt} > ${from}`,
        ),
      ),
      active: await recent((from) =>
        one(sql`select count(distinct ${sessions.userId}) as n from ${sessions}
          join ${users} on ${users.id} = ${sessions.userId}
          where ${athlete} and ${lastSeen} > ${from}`),
      ),
      deleted: await one(
        sql`select count(*) as n from ${users} where ${users.deletedAt} is not null`,
      ),
    },
    senders: await recent((from) =>
      one(sql`select count(distinct coalesce(${files.contributorUserId}, ${files.senderKey}, ${files.passId})) as n
        from ${files} where ${files.completedAt} > ${from}`),
    ),
    events: {
      total: await one(sql`select count(*) as n from ${hops} where ${event}`),
      new: await recent((from) =>
        one(sql`select count(*) as n from ${hops} where ${event} and ${hops.createdAt} > ${from}`),
      ),
    },
    clips: {
      total: await one(sql`select count(*) as n from ${files} where ${kept}`),
      new: await recent((from) =>
        one(
          sql`select count(*) as n from ${files} where ${kept} and ${files.completedAt} > ${from}`,
        ),
      ),
    },
    storage: {
      bytes: await one(sql`select sum(${files.size}) as n from ${files} where ${kept}`),
      pendingBytes: await one(
        sql`select sum(${files.size}) as n from ${files} where ${files.status} = 'pending'`,
      ),
      freeBytes: await one(
        sql`select sum(${files.size}) as n from ${files} where ${kept} and not ${ownerHasPlus}`,
      ),
      plusBytes: await one(
        sql`select sum(${files.size}) as n from ${files} where ${kept} and ${ownerHasPlus}`,
      ),
    },
    plus: {
      subscribers: await one(
        sql`select count(*) as n from ${users} where ${athlete} and ${hasPlusSql(users.id, now)}`,
      ),
    },
    waitlist: await one(sql`select count(*) as n from ${waitlist}`),
    daily,
  };
}
