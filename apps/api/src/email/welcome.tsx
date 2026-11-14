/** @jsxImportSource hono/jsx */
import { colorFor, MAX_FILE_BYTES, type PaletteColor } from "@hop/shared";
import type { UserRow } from "../db/schema";
import type { Env } from "../env";
import {
  Button,
  EmailDocument,
  Hero,
  LinkPill,
  renderEmail,
  Steps,
  Subtitle,
  Text,
  Title,
} from "./layout";
import { type RenderedEmail, sendEmail } from "./send";

export type WelcomeInput = {
  appUrl: string;
  handle: string;
  name: string | null;
  color: PaletteColor;
};

const STEPS = [
  {
    title: "Share your link",
    body: "Show your QR code from the app, or put the link in your bio and group chats.",
  },
  {
    title: "Say “upload it on my Hop”",
    body: `Friends, coaches and the crowd can send clips from any phone, up to ${MAX_FILE_BYTES / 1024 ** 3} GB each.`,
  },
  {
    title: "Get every angle",
    body: "Clips land in your inbox, sorted by event, in full quality.",
  },
];

/** "Matej" from "Matej Matiasko"; nothing when there's no usable name. */
function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length <= 40 ? first : null;
}

/** Sent once, right after an athlete claims their handle. */
export async function welcomeEmail({
  appUrl,
  handle,
  name,
  color,
}: WelcomeInput): Promise<RenderedEmail> {
  const pageUrl = `${appUrl}/${handle}`;
  const host = new URL(appUrl).host;
  const pageLabel = `${host}/${handle}`;
  const inboxUrl = `${appUrl}/app`;
  const first = firstName(name);
  const intro = `${first ? `Hi ${first}! ` : ""}Your page is live. Anyone who films you can send their clips straight to your inbox, without an app or an account.`;
  const footer = `You’re getting this because you just claimed @${handle} on Hop.`;

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title="You’re on Hop!"
      preheader={`Your page is live at ${pageLabel}. Here’s how to use it at your next event.`}
      footer={<p style={{ margin: "0" }}>{footer}</p>}
    >
      <Hero src={`${appUrl}/email/cheer-${color.id}.png`} color={color} />
      <Title>You’re on Hop!</Title>
      <Text>{intro}</Text>
      <div style={{ height: "24px", lineHeight: "24px" }}>&nbsp;</div>
      <LinkPill href={pageUrl} host={host} handle={handle} color={color} />
      <Subtitle>At your next event</Subtitle>
      <Steps items={STEPS} color={color} />
      <div style={{ height: "8px", lineHeight: "8px" }}>&nbsp;</div>
      <Button href={inboxUrl}>Open your inbox</Button>
    </EmailDocument>,
  );

  const text = [
    "You’re on Hop!",
    "",
    intro,
    "",
    `Your link: ${pageUrl}`,
    "",
    "At your next event",
    ...STEPS.map((step, index) => `${index + 1}. ${step.title}. ${step.body}`),
    "",
    `Open your inbox: ${inboxUrl}`,
    "",
    "--",
    footer,
  ].join("\n");

  return { subject: `Your Hop is live: ${pageLabel}`, html, text };
}

/** Best effort: only to verified addresses, and never twice for the same account. */
export async function sendWelcomeEmail(
  env: Env,
  user: Pick<UserRow, "id" | "email" | "emailVerified" | "name" | "color"> & { handle: string },
): Promise<void> {
  if (!user.email || !user.emailVerified) return;
  const email = await welcomeEmail({
    appUrl: env.APP_URL,
    handle: user.handle,
    name: user.name,
    color: colorFor(user.color, user.id),
  });
  await sendEmail(env, {
    ...email,
    to: user.email,
    idempotencyKey: `welcome/${user.id}`,
    category: "welcome",
  });
}
