/** @jsxImportSource hono/jsx */
import { Button, EmailDocument, renderEmail, Text, Title } from "./layout";
import type { RenderedEmail } from "./send";

export type ClipsExpiringInput = {
  appUrl: string;
  /** How many clips go. */
  clips: number;
  /** When they go (ms since 1970). */
  at: number;
  /** A week ahead, or the day before. */
  when: "notice" | "reminder";
};

/** "Sunday 23 November", in UTC: Hop doesn't know the athlete's time zone. */
export function expiryDay(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * Free-plan clips are about to go: a week ahead, and again the day before.
 * Sent whatever the new-clips setting, as it's about losing them. It points
 * to saving them from the inbox, and to Hop+, which keeps every clip.
 */
export async function clipsExpiringEmail({
  appUrl,
  clips,
  at,
  when,
}: ClipsExpiringInput): Promise<RenderedEmail> {
  const count = clips === 1 ? "1 clip" : `${clips.toLocaleString("en-GB")} clips`;
  const them = clips === 1 ? "it" : "them";
  const day = expiryDay(at);
  const leave = clips === 1 ? "leaves" : "leave";
  const title =
    when === "notice"
      ? `${count} ${leave} your inbox on ${day}`
      : `Tomorrow, ${count} ${leave} your inbox`;
  const why = `On the free plan, Hop keeps clips for 30 days. ${
    when === "notice" ? `On ${day}, ${count}` : `Tomorrow (${day}), ${count}`
  } ${clips === 1 ? "goes" : "go"} for good.`;
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
export function clipsExpiringPush({ clips, at, when }: Omit<ClipsExpiringInput, "appUrl">) {
  const count = clips === 1 ? "1 clip" : `${clips.toLocaleString("en-GB")} clips`;
  const leave = clips === 1 ? "leaves" : "leave";
  return {
    title:
      when === "notice"
        ? `${count} ${leave} your inbox on ${expiryDay(at)}`
        : `Tomorrow, ${count} ${leave} your inbox`,
    body:
      clips === 1
        ? "Save it, or get Hop+ to keep every clip for good."
        : "Save them, or get Hop+ to keep every clip for good.",
  };
}
