/** @jsxImportSource hono/jsx */
import type { ReportRow } from "../db/schema";
import type { Env } from "../env";
import { EmailDocument, renderEmail, Subtitle, Text, Title } from "./layout";
import { type RenderedEmail, sendEmail } from "./send";

const REASONS: Record<ReportRow["reason"], string> = {
  sexual: "Sexual content",
  violence: "Violence or threats",
  harassment: "Harassment or hate",
  spam: "Spam or scam",
  other: "Something else",
};

export type ReportEmailInput = {
  appUrl: string;
  report: ReportRow;
  /** The handle of the athlete who reported a clip, or whose page was reported. */
  handle: string | null;
};

/**
 * Tells Hop's team about a report, so someone looks at it. Facts only, with
 * the IDs needed to find the clip or the account (see "Reports and blocks"
 * in the README).
 */
export async function reportEmail({
  appUrl,
  report,
  handle,
}: ReportEmailInput): Promise<RenderedEmail> {
  const host = new URL(appUrl).host;
  const what =
    report.kind === "clip"
      ? `A clip sent to ${handle ? `@${handle}` : "an athlete"} was reported by them.`
      : `The page ${host}/${handle ?? "?"} was reported by a visitor.`;
  const facts: [string, string][] = [
    ["Reason", REASONS[report.reason]],
    ["Report", report.id],
    ...(report.fileId ? ([["Clip", report.fileId]] as [string, string][]) : []),
    ...(report.contributorName
      ? ([["Sent as", report.contributorName]] as [string, string][])
      : []),
    ...(report.subjectUserId
      ? ([["Reported account", report.subjectUserId]] as [string, string][])
      : []),
    ...(report.reporterId ? ([["Reported by", report.reporterId]] as [string, string][]) : []),
    ["Sender key", report.senderKey ? "yes (they can be blocked)" : "none"],
  ];
  const subject = `Report: ${report.kind === "clip" ? "a clip" : `${host}/${handle ?? "?"}`} (${REASONS[report.reason]})`;

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title={subject}
      preheader={what}
      footer={<p style={{ margin: "0" }}>Sent to Hop's team for every report.</p>}
    >
      <Title>Something was reported</Title>
      <Text>{what}</Text>
      {report.note && (
        <>
          <Subtitle>Their words</Subtitle>
          <Text>{report.note}</Text>
        </>
      )}
      <Subtitle>Details</Subtitle>
      {facts.map(([label, value]) => (
        <Text muted>
          {label}: {value}
        </Text>
      ))}
    </EmailDocument>,
  );

  const text = [
    "Something was reported",
    "",
    what,
    ...(report.note ? ["", "Their words:", report.note] : []),
    "",
    ...facts.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");

  return { subject, html, text };
}

/** Sends a report to REPORTS_EMAIL. Each report is sent once. */
export async function sendReportEmail(env: Env, input: Omit<ReportEmailInput, "appUrl">) {
  const email = await reportEmail({ ...input, appUrl: env.APP_URL });
  await sendEmail(env, {
    ...email,
    to: env.REPORTS_EMAIL,
    idempotencyKey: `report/${input.report.id}`,
    category: "report",
  });
}
