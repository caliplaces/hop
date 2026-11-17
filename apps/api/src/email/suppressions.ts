import { eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db";
import { emailSuppressions, users } from "../db/schema";

/**
 * Addresses Hop no longer emails (see emailSuppressions in db/schema.ts):
 * Resend's webhook tells Hop which, and sendEmail checks every email
 * against them. Kept a year: by then an address that bounced may work
 * again, and Resend still won't send to one it has suppressed.
 */

export type SuppressionReason = (typeof emailSuppressions.$inferSelect)["reason"];

export const KEEP_SUPPRESSIONS_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * An address as the list keys it: spaces trimmed, A–Z lowercased. Exactly
 * what SQLite's lower(trim(x)) does, so SQL matching an account's address
 * (the expiry claim, deleting an account) agrees with it on every input.
 * Only ASCII letters change: mail domains are ASCII (punycode), and a
 * mailbox's other letters are the server's to interpret.
 */
export function normalizeAddress(address: string): string {
  // Spaces trimmed by index, as SQLite's trim() does: a regex like / +$/
  // takes quadratic time on a long run of spaces that isn't at the end.
  let start = 0;
  let end = address.length;
  while (start < end && address[start] === " ") start++;
  while (end > start && address[end - 1] === " ") end--;
  return address.slice(start, end).replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
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

/**
 * Statement: forgets the list's entry for an account being deleted (`live`
 * matches it, not yet marked deleted), if its address was verified and no
 * other live account has it. An unverified address may be someone else's,
 * whose entry must stay. Runs in deleteAccount's batch (lib/accounts.ts).
 */
export function forgetForAccount(db: Db, userId: string) {
  return db.delete(emailSuppressions).where(
    sql`${emailSuppressions.email} in (
      select lower(trim(${users.email})) from ${users}
      where ${users.id} = ${userId}
        and ${users.deletedAt} is null
        and ${users.emailVerified} = 1
        and ${users.email} is not null
    )
    and not exists (
      select 1 from ${users} as other
      where other.id <> ${userId}
        and other.deleted_at is null
        and lower(trim(other.email)) = ${emailSuppressions.email}
    )`,
  );
}

/** The cleanup's part: entries older than KEEP_SUPPRESSIONS_MS go. */
export async function forgetOldSuppressions(db: Db, now = Date.now()): Promise<void> {
  await db
    .delete(emailSuppressions)
    .where(lt(emailSuppressions.createdAt, now - KEEP_SUPPRESSIONS_MS));
}
