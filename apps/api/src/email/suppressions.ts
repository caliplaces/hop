import { eq, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";
import { emailSuppressions } from "../db/schema";

/**
 * Addresses Hop no longer emails (see emailSuppressions in db/schema.ts):
 * Resend's webhook tells Hop which, and sendEmail checks every email
 * against them.
 */

export type SuppressionReason = (typeof emailSuppressions.$inferSelect)["reason"];

/** An address as the list keys it: trimmed and lowercased. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Whether Hop no longer emails this address. */
export async function isSuppressed(db: Db, address: string): Promise<boolean> {
  const row = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, normalizeAddress(address)))
    .get();
  return row !== undefined;
}

/** SQL: Hop no longer emails the address in `column`, however it's written there. */
export function suppressedSql(column: AnySQLiteColumn) {
  return sql`exists (
    select 1 from ${emailSuppressions}
    where ${emailSuppressions.email} = lower(trim(${column}))
  )`;
}

/** Adds addresses to the list. Each keeps the reason it was first added for. */
export async function suppress(
  db: Db,
  addresses: string[],
  reason: SuppressionReason,
  now = Date.now(),
): Promise<void> {
  const unique = [...new Set(addresses.map(normalizeAddress))];
  if (unique.length === 0) return;
  await db
    .insert(emailSuppressions)
    .values(unique.map((email) => ({ email, reason, createdAt: now })))
    .onConflictDoNothing();
}
