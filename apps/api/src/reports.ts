import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "./db";
import { reports, users } from "./db/schema";
import { reportsEmail } from "./email/report";
import { sendEmail } from "./email/send";
import type { Env } from "./env";

/** The most reports one email carries; any more wait for the next run. */
const MAX_PER_EMAIL = 50;

/**
 * Emails Hop's team the reports and blocks not yet sent, in one email, every
 * five minutes. Going from here rather than from each request keeps a flood
 * of reports to at most one email a run.
 *
 * Each email is a batch claimed once (reports.email_batch, the claim time)
 * and sent with that batch as its idempotency key. A send that fails, or
 * whose reply is lost, goes again next run as the very same batch, which
 * Resend then drops if it already went; reports that came since wait for
 * the batch after. A report counts as sent once its batch's email is.
 */
export async function announceReports(env: Env): Promise<number> {
  const db = getDb(env.DB);
  const unsent = await db
    .select({ batch: reports.emailBatch })
    .from(reports)
    .where(and(isNotNull(reports.emailBatch), isNull(reports.emailedAt)))
    .orderBy(asc(reports.emailBatch))
    .get();
  let batch = unsent?.batch ?? null;
  if (batch === null) {
    batch = Date.now();
    const claimed = await db
      .update(reports)
      .set({ emailBatch: batch })
      .where(
        inArray(
          reports.id,
          db
            .select({ id: reports.id })
            .from(reports)
            .where(and(isNull(reports.emailedAt), isNull(reports.emailBatch)))
            .orderBy(asc(reports.createdAt))
            .limit(MAX_PER_EMAIL),
        ),
      )
      .returning({ id: reports.id });
    if (claimed.length === 0) return 0;
  }

  const reporter = alias(users, "reporter");
  const subject = alias(users, "subject");
  const rows = await db
    .select({ report: reports, reporterHandle: reporter.handle, subjectHandle: subject.handle })
    .from(reports)
    .leftJoin(reporter, eq(reporter.id, reports.reporterId))
    .leftJoin(subject, eq(subject.id, reports.subjectUserId))
    .where(eq(reports.emailBatch, batch))
    .orderBy(asc(reports.createdAt));
  const items = rows.map((row) => ({
    report: row.report,
    handle: row.report.kind === "profile" ? row.subjectHandle : row.reporterHandle,
  }));
  const email = await reportsEmail(env.APP_URL, items);
  await sendEmail(env, {
    ...email,
    to: env.REPORTS_EMAIL,
    idempotencyKey: `reports/${env.ENVIRONMENT}/${batch}`,
    category: "report",
  });
  await db.update(reports).set({ emailedAt: Date.now() }).where(eq(reports.emailBatch, batch));
  return rows.length;
}
