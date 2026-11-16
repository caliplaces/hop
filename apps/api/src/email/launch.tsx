/** @jsxImportSource hono/jsx */
import { colorFor, MAX_FILE_BYTES } from "@hop/shared";
import { Button, EmailDocument, Hero, renderEmail, Steps, Subtitle, Text, Title } from "./layout";
import type { RenderedEmail } from "./send";

export type LaunchInput = {
  appUrl: string;
  /** The App Store page, once the app is out. */
  appStoreUrl?: string;
};

/** Hop's own colour (grape), as there's no athlete to take one from yet. */
const BRAND = colorFor("grape", "launch");

const STEPS = [
  {
    title: "Get your link",
    body: "Sign in and pick your handle: onmyhop.com/you.",
  },
  {
    title: "Share it at your next event",
    body: `Anyone who films you sends their clips from any phone, up to ${MAX_FILE_BYTES / 1024 ** 3} GB each, without an app or an account.`,
  },
  {
    title: "Get every angle",
    body: "Clips land in your inbox, sorted by event, in full quality.",
  },
];

/** The one email the waitlist gets, when Hop launches. */
export async function launchEmail({ appUrl, appStoreUrl }: LaunchInput): Promise<RenderedEmail> {
  const host = new URL(appUrl).host;
  const startUrl = `${appUrl}/app`;
  const intro =
    "You asked us to tell you when Hop opened. It’s open: get your link, and every clip people film of you lands in one inbox.";
  const footer = `You’re getting this because you joined the Hop waitlist at ${host}. It’s the only email the waitlist sends, and your address is deleted from it a day after.`;

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title="Hop is live!"
      preheader="Get your link, and every clip people film of you lands in one inbox."
      footer={<p style={{ margin: "0" }}>{footer}</p>}
    >
      <Hero src={`${appUrl}/email/cheer-${BRAND.id}.png`} color={BRAND} />
      <Title>Hop is live!</Title>
      <Text>{intro}</Text>
      <Subtitle>How it works</Subtitle>
      <Steps items={STEPS} color={BRAND} />
      <div style={{ height: "8px", lineHeight: "8px" }}>&nbsp;</div>
      <Button href={startUrl}>Get your Hop</Button>
      {appStoreUrl ? (
        <Text muted>
          On iPhone?{" "}
          <a href={appStoreUrl} style={{ color: "inherit", textDecoration: "underline" }}>
            Get the app
          </a>{" "}
          for your QR code, Event mode and your inbox on the go.
        </Text>
      ) : null}
    </EmailDocument>,
  );

  const text = [
    "Hop is live!",
    "",
    intro,
    "",
    "How it works",
    ...STEPS.map((step, index) => `${index + 1}. ${step.title}. ${step.body}`),
    "",
    `Get your Hop: ${startUrl}`,
    ...(appStoreUrl ? ["", `On iPhone? Get the app: ${appStoreUrl}`] : []),
    "",
    "--",
    footer,
  ].join("\n");

  return { subject: "Hop is live: get your link", html, text };
}
