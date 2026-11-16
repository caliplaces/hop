/** @jsxImportSource hono/jsx */
import { Button, EmailDocument, renderEmail, Text, Title } from "./layout";
import type { RenderedEmail } from "./send";

export type ClipsExpiringInput = {
  appUrl: string;
  /** How many clips go. */
  clips: number;
  /**
   * The day they go, as midnight UTC (ms since 1970). A calendar day, the
   * same wherever the athlete is: the clips stay until it has ended
   * everywhere (see goesAt in src/expiry.ts).
   */
  day: number;
  /** A week ahead, or the day before. */
  when: "notice" | "reminder";
};

/** "Monday 23 November": the calendar day, which UTC midnight falls on. */
export function expiryDay(day: number): string {
  return new Date(day).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** "12 clips leave your inbox on Monday 23 November", and the reminder's "Last call: …". */
function headline({ clips, day, when }: Omit<ClipsExpiringInput, "appUrl">) {
  const count = clips === 1 ? "1 clip" : `${clips.toLocaleString("en-GB")} clips`;
  const leave = clips === 1 ? "leaves" : "leave";
  const line = `${count} ${leave} your inbox on ${expiryDay(day)}`;
  return when === "notice" ? line : `Last call: ${line}`;
}

/**
 * Free-plan clips are about to go: a week ahead, and again the day before.
 * Sent whatever the new-clips setting, as it's about losing them. It points
 * to saving them from the inbox, and to Hop+, which keeps every clip. The
 * day is a calendar day, never "tomorrow": Hop doesn't know where the athlete
 * is, and the email may be read later.
 */
export async function clipsExpiringEmail(input: ClipsExpiringInput): Promise<RenderedEmail> {
  const { appUrl, clips, day } = input;
  const count = clips === 1 ? "1 clip" : `${clips.toLocaleString("en-GB")} clips`;
  const them = clips === 1 ? "it" : "them";
  const title = headline(input);
  const why = `On the free plan, Hop keeps clips for 30 days. On ${expiryDay(day)}, ${count} ${
    clips === 1 ? "goes" : "go"
  } for good.`;
  const keep = `To keep ${them}, save ${them} to your phone or computer from your inbox, or get Hop+ in the Hop app, which keeps every clip for good.`;
  const inboxUrl = `${appUrl}/app`;
  const footer = "You’re getting this because clips in your Hop inbox are about to be deleted.";

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title={title}
      preheader={why}
      footer={<p style={{ margin: "0" }}>{footer}</p>}
    >
      <Title>{title}</Title>
      <Text>{why}</Text>
      <Text>{keep}</Text>
      <div style={{ height: "24px", lineHeight: "24px" }}>&nbsp;</div>
      <Button href={inboxUrl}>Save your clips</Button>
    </EmailDocument>,
  );

  const text = [
    title,
    "",
    why,
    "",
    keep,
    "",
    `Save your clips: ${inboxUrl}`,
    "",
    "--",
    footer,
  ].join("\n");
  return { subject: title, html, text };
}

/** The same, for a notification on the phone. */
export function clipsExpiringPush(input: Omit<ClipsExpiringInput, "appUrl">) {
  return {
    title: headline(input),
    body:
      input.clips === 1
        ? "Save it, or get Hop+ to keep every clip for good."
        : "Save them, or get Hop+ to keep every clip for good.",
  };
}
