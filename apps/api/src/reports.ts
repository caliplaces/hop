import { asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "./db";
import { reports, users } from "./db/schema";
import { reportsEmail } from "./email/report";
import { sendEmail } from "./email/send";
import type { Env } from "./env";
import { sha256Hex } from "./lib/crypto";

/** The most reports one email carries; any more wait for the next run. */
const MAX_PER_EMAIL = 50;

/**
 * Emails Hop's team the reports and blocks not yet sent, in one email, every
 * five minutes. Going from here rather than from each request keeps a flood
 * of reports to at most one email a run, and a send that fails is simply
 * tried again next time: a report counts as sent only once its email is.
 */
export async function announceReports(env: Env): Promise<number> {
  const db = getDb(env.DB);
  const reporter = alias(users, "reporter");
  const subject = alias(users, "subject");
  const rows = await db
    .select({ report: reports, reporterHandle: reporter.handle, subjectHandle: subject.handle })
    .from(reports)
    .leftJoin(reporter, eq(reporter.id, reports.reporterId))
    .leftJoin(subject, eq(subject.id, reports.subjectUserId))
    .where(isNull(reports.emailedAt))
    .orderBy(asc(reports.createdAt))
    .limit(MAX_PER_EMAIL);
  if (rows.length === 0) return 0;

  const items = rows.map((row) => ({
    report: row.report,
    handle: row.report.kind === "profile" ? row.subjectHandle : row.reporterHandle,
  }));
  const ids = rows.map((row) => row.report.id);
  const email = await reportsEmail(env.APP_URL, items);
  await sendEmail(env, {
    ...email,
    to: env.REPORTS_EMAIL,
    // The same reports, retried, send once.
    idempotencyKey: `reports/${(await sha256Hex(ids.join(","))).slice(0, 32)}`,
    category: "report",
  });
  await db.update(reports).set({ emailedAt: Date.now() }).where(inArray(reports.id, ids));
  return rows.length;
}
