/** @jsxImportSource hono/jsx */
import type { UserRow } from "../db/schema";
import type { Env } from "../env";
import { EmailDocument, renderEmail, Subtitle, Text, Title } from "./layout";
import { type RenderedEmail, sendEmail } from "./send";

export type AccountDeletedInput = {
  appUrl: string;
  /** Their handle, if they had claimed one. */
  handle: string | null;
  /** Whether deleting it cancelled Hop+ bought on the website (Stripe). */
  cancelledWebHopPlus: boolean;
};

/**
 * Sent once, right after an athlete deletes their account: a record for
 * them, and a warning if it wasn't them. It also says what became of Hop+:
 * bought on the website, it was cancelled with the account; bought in the
 * iPhone app, Apple bills it until it's cancelled there. And their
 * Caliplaces account is separate.
 */
export async function accountDeletedEmail({
  appUrl,
  handle,
  cancelledWebHopPlus,
}: AccountDeletedInput): Promise<RenderedEmail> {
  const host = new URL(appUrl).host;
  const what = handle
    ? `Your Hop account, ${host}/${handle}, is deleted. Your name, email and photo are gone, and your clips are being removed from Hop’s storage.`
    : "Your Hop account is deleted. Your name, email and photo are gone, and your clips are being removed from Hop’s storage.";
  const kept = handle
    ? `Nobody can take ${host}/${handle} again, you included, so clips sent to your old link or QR code can’t reach anyone else.`
    : null;
  const sent = handle
    ? `Clips you sent other athletes stay with them, under @${handle}.`
    : "Clips you sent other athletes stay with them, without your name.";
  const notYou =
    "If you didn’t delete it, someone else can sign in to your Caliplaces account. Change your Caliplaces password.";
  const webHopPlus = cancelledWebHopPlus
    ? "Your Hop+ from the website is cancelled with your account, and you won’t be charged for it again."
    : null;
  const appHopPlus =
    "If you had Hop+ from the iPhone app, deleting your account doesn’t cancel it. Apple keeps billing until you cancel it in your Apple Account’s subscriptions.";
  const caliplaces =
    "Your Caliplaces account isn’t affected. You can sign in to Hop with it again any time, as a new account.";
  const footer = "You’re getting this because a Hop account using this address was deleted.";

  const html = await renderEmail(
    <EmailDocument
      appUrl={appUrl}
      title="Your Hop account is deleted"
      preheader={what}
      footer={<p style={{ margin: "0" }}>{footer}</p>}
    >
      <Title>Your Hop account is deleted</Title>
      <Text>{what}</Text>
      {kept && <Text muted>{kept}</Text>}
      <Subtitle>Wasn’t you?</Subtitle>
      <Text>{notYou}</Text>
      <Subtitle>Good to know</Subtitle>
      <Text>{sent}</Text>
      {webHopPlus && <Text>{webHopPlus}</Text>}
      <Text>{appHopPlus}</Text>
      <Text>{caliplaces}</Text>
    </EmailDocument>,
  );

  const text = [
    "Your Hop account is deleted",
    "",
    what,
    ...(kept ? ["", kept] : []),
    "",
    "Wasn’t you?",
    notYou,
    "",
    "Good to know",
    sent,
    ...(webHopPlus ? [webHopPlus] : []),
    appHopPlus,
    caliplaces,
    "",
    "--",
    footer,
  ].join("\n");

  return { subject: "Your Hop account is deleted", html, text };
}

/** Best effort, and only to a verified address. */
export async function sendAccountDeletedEmail(
  env: Env,
  user: Pick<UserRow, "id" | "email" | "emailVerified" | "handle">,
  { cancelledWebHopPlus }: Pick<AccountDeletedInput, "cancelledWebHopPlus">,
): Promise<void> {
  if (!user.email || !user.emailVerified) return;
  const email = await accountDeletedEmail({
    appUrl: env.APP_URL,
    handle: user.handle,
    cancelledWebHopPlus,
  });
  await sendEmail(env, {
    ...email,
    to: user.email,
    idempotencyKey: `account-deleted/${user.id}`,
    category: "account-deleted",
  });
}
