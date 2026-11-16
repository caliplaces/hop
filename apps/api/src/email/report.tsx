/** @jsxImportSource hono/jsx */
import type { ReportReason } from "@hop/shared";
import type { ReportRow } from "../db/schema";
import { Divider, EmailDocument, renderEmail, Subtitle, Text, Title } from "./layout";
import type { RenderedEmail } from "./send";

const REASONS: Record<ReportReason, string> = {
  sexual: "Sexual content",
  violence: "Violence or threats",
  harassment: "Harassment or hate",
  spam: "Spam or scam",
  other: "Something else",
};

export type ReportItem = {
  report: ReportRow;
  /** The athlete's handle: who reported or blocked, or whose page was reported. */
  handle: string | null;
};

/** One report as a heading and its facts, for the email in both forms. */
function describe(appUrl: string, { report, handle }: ReportItem) {
  const host = new URL(appUrl).host;
  const athlete = handle ? `@${handle}` : "an athlete";
  const heading = {
    clip: `${athlete} reported a clip: ${REASONS[report.reason]}`,
    block: `${athlete} blocked a sender`,
    profile: `A visitor reported ${host}/${handle ?? "?"}: ${REASONS[report.reason]}`,
  }[report.kind];
  const facts: [string, string | null][] = [
    ["Their words", report.note],
    ["Sent as", report.contributorName],
    ["Note on the clip", report.clipNote],
    ["File name", report.clipName],
    ["Clip", report.fileId],
    ["Reported account", report.subjectUserId],
    ["Report", report.id],
    ["When", new Date(report.createdAt).toISOString()],
  ];
  return { heading, facts: facts.filter((fact): fact is [string, string] => Boolean(fact[1])) };
}

/**
 * Tells Hop's team about new reports and blocks, so someone looks at them.
 * Facts only, with the IDs needed to find the clip or the account (see
 * "Reports and blocks" in the README).
 */
export async function reportsEmail(appUrl: string, items: ReportItem[]): Promise<RenderedEmail> {
  const described = items.map((item) => describe(appUrl, item));
  const subject =
    items.length === 1
      ? `Report: ${described[0]?.heading ?? ""}`
      : `${items.length} new reports and blocks`;

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title={subject}
      preheader={described.map((item) => item.heading).join(" · ")}
      footer={<p style={{ margin: "0" }}>Sent to Hop's team for every report and block.</p>}
    >
      <Title>{items.length === 1 ? "Something was reported" : "New reports"}</Title>
      {described.map(({ heading, facts }, index) => (
        <>
          {index > 0 && <Divider />}
          <Subtitle>{heading}</Subtitle>
          {facts.map(([label, value]) => (
            <Text muted>
              {label}: {value}
            </Text>
          ))}
        </>
      ))}
    </EmailDocument>,
  );

  const text = described
    .map(({ heading, facts }) =>
      [heading, ...facts.map(([label, value]) => `${label}: ${value}`)].join("\n"),
    )
    .join("\n\n");

  return { subject, html, text };
}
