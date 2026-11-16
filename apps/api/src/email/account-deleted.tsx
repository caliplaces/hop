/** @jsxImportSource hono/jsx */
import type { UserRow } from "../db/schema";
import type { Env } from "../env";
import { EmailDocument, renderEmail, Subtitle, Text, Title } from "./layout";
import { type RenderedEmail, sendEmail } from "./send";

export type AccountDeletedInput = {
  appUrl: string;
  /** Their handle, if they had claimed one. */
  handle: string | null;
};

/**
 * Sent once, right after an athlete deletes their account: a record for
 * them, and a warning if it wasn't them. It also says what deleting doesn't
 * do: a Hop+ subscription is billed by Apple until it's cancelled there, and
 * their Caliplaces account is separate.
 */
export async function accountDeletedEmail({
  appUrl,
  handle,
}: AccountDeletedInput): Promise<RenderedEmail> {
  const host = new URL(appUrl).host;
  const what = handle
    ? `Your Hop account, ${host}/${handle}, and every clip in it have been deleted.`
    : "Your Hop account and everything in it have been deleted.";
  const kept = handle
    ? `Nobody can take over ${host}/${handle}, so clips sent to your old link or QR code can’t reach anyone else.`
    : null;
  const notYou =
    "If you didn’t delete it, someone else can sign in to your Caliplaces account. Change your Caliplaces password.";
  const hopPlus =
    "If you had Hop+, deleting your account doesn’t cancel it. Apple keeps billing until you cancel it in your Apple Account’s subscriptions.";
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
      <Text>{hopPlus}</Text>
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
    hopPlus,
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
): Promise<void> {
  if (!user.email || !user.emailVerified) return;
  const email = await accountDeletedEmail({ appUrl: env.APP_URL, handle: user.handle });
  await sendEmail(env, {
    ...email,
    to: user.email,
    idempotencyKey: `account-deleted/${user.id}`,
    category: "account-deleted",
  });
}
