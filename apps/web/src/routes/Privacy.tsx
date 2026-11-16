import type { ReactNode } from "react";
import { Logo } from "../components/Logo";

/**
 * Who runs Hop. Filled in before launch: App Review and the GDPR both need a
 * name and an address on this page.
 */
const OPERATOR = {
  name: "[COMPANY NAME]",
  address: "[REGISTERED ADDRESS]",
};
const CONTACT = "hello@onmyhop.com";
const UPDATED = "16 November 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-fg/85">{children}</div>
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-muted">{children}</ul>;
}

/**
 * onmyhop.com/privacy: what Hop keeps about whom, why, for how long, and who
 * else handles it. Written from what the code does; keep the two in step
 * (apps/api/README.md describes each piece).
 */
export function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 pt-6 pb-16">
      <header>
        <a href="/" aria-label="Hop home">
          <Logo />
        </a>
      </header>

      <h1 className="mt-10 text-[32px] leading-tight font-bold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-fg/85">
        Hop gives athletes a link (onmyhop.com/your-name) where anyone who filmed them can send
        their clips, straight to the athlete’s private inbox. This page explains what Hop keeps
        about you, why, for how long, and what you can do about it. There are no ads on Hop, nothing
        is sold, and nothing tracks you across other sites.
      </p>

      <Section title="Who runs Hop">
        <p>
          Hop (onmyhop.com and the Hop app) is run by {OPERATOR.name}, {OPERATOR.address}. For
          anything about your data, write to{" "}
          <a className="underline underline-offset-4" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </Section>

      <Section title="If you have a Hop account">
        <p>You sign in with a Caliplaces account. Hop keeps:</p>
        <List>
          <li>
            From Caliplaces: your account ID, name, email address and whether it’s verified. Hop
            never sees your password.
          </li>
          <li>
            Your profile: your handle, the name and photo you choose, and your colour. These are
            public: anyone with your link sees them. Photos are rebuilt so they carry no location or
            camera details.
          </li>
          <li>
            Whether you have Hop+. Your page shows a Hop+ mark when you do, so anyone who knows your
            handle can see it.
          </li>
          <li>
            The clips people send you, with what came with them: the file name, size and type, the
            sender’s name and note, and when it arrived.
          </li>
          <li>
            If you subscribe to Hop+: what Apple tells Hop about the subscription (the product, when
            it renews or ends, and an account token that ties it to you). Apple handles the payment;
            Hop never sees your card.
          </li>
          <li>
            For Event mode: the push token Apple gives your Live Activity, until the event ends.
          </li>
          <li>Your email settings, the senders you’ve blocked and the reports you’ve made.</li>
        </List>
      </Section>

      <Section title="If you send someone clips">
        <p>You don’t need an account. Hop keeps:</p>
        <List>
          <li>
            The clips you send, the name and note you add (or the random name Hop makes up), and
            when you sent them. Only the athlete you sent them to can see them.
          </li>
          <li>
            A one-way scrambled (hashed) form of your IP address, to stop abuse and enforce limits.
          </li>
          <li>
            A random key your browser keeps in a cookie, stored by Hop only in scrambled form, so
            the athlete can block you from sending more if they need to.
          </li>
          <li>If you’re signed in, your account, so your clips show your @handle.</li>
        </List>
        <p>
          Your browser also remembers the name you sent under and how far your uploads got, so they
          can carry on after a reload. That stays on your device.
        </p>
      </Section>

      <Section title="If you report something or join the waitlist">
        <List>
          <li>
            Reporting a page keeps your report and a scrambled form of your IP address, so the same
            page isn’t reported over and over.
          </li>
          <li>
            The launch waitlist keeps your email address until a day after the launch email reaches
            you.
          </li>
        </List>
      </Section>

      <Section title="Why Hop uses it">
        <List>
          <li>To run Hop for you: your page, your inbox, uploads, Hop+ and your emails.</li>
          <li>
            To keep Hop safe: limits, spotting abuse, blocks and looking into reports. This is Hop’s
            legitimate interest in a service people can trust.
          </li>
          <li>Where the law requires it, for example keeping reported content for a while.</li>
        </List>
        <p>
          Hop emails you when clips arrive. Every email has an unsubscribe link, and you can turn
          them off in your account.
        </p>
      </Section>

      <Section title="Who else handles it">
        <p>Hop uses a few providers, each only for its part:</p>
        <List>
          <li>
            Cloudflare runs Hop’s servers, database and file storage, and its Turnstile check makes
            sure uploads come from people, not bots.
          </li>
          <li>Resend delivers Hop’s emails.</li>
          <li>Apple handles App Store purchases and the app’s push notifications.</li>
          <li>Caliplaces handles sign-in.</li>
        </List>
        <p>
          Some of them process data outside the EU, under safeguards such as the EU’s Standard
          Contractual Clauses.
        </p>
      </Section>

      <Section title="How long it’s kept">
        <List>
          <li>
            Clips: until you delete them, or your account. (The free plan’s 30-day limit isn’t
            applied yet; this page will say when it is.)
          </li>
          <li>Sign-ins: 30 days on the website, and up to a year in the app.</li>
          <li>
            Reported clips: kept for up to 30 days after they’re reported, even if deleted, so Hop’s
            team can look into them. Reports are kept for a year.
          </li>
          <li>Everything else: until you delete it, or your account.</li>
        </List>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can delete your account in the app (Account → Delete Account) or on the website (your
          account menu). Your name, email, photo, sign-ins and subscription records go at once, and
          your clips are removed from storage within a day. Clips you sent other athletes stay with
          them, under your @handle if you had one.
        </p>
        <p>
          Your handle stays reserved, so nobody else can take your link and receive clips meant for
          you. Deleting your account doesn’t cancel Hop+: cancel it in your Apple Account’s
          subscriptions. Your Caliplaces account isn’t affected.
        </p>
      </Section>

      <Section title="Cookies">
        <List>
          <li>
            <code>hop_session</code> keeps you signed in on the website.
          </li>
          <li>
            <code>hop_sender</code> is the random key described above, on the upload page only.
          </li>
          <li>Cloudflare’s Turnstile check may set its own, to tell people from bots.</li>
        </List>
        <p>There are no advertising or analytics cookies.</p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask to see the data Hop has about you, to correct it, to take it with you, to
          delete it, or to object to how it’s used. Most of this you can do yourself in your
          account. For anything else, write to{" "}
          <a className="underline underline-offset-4" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          , and you can always complain to your data protection authority.
        </p>
        <p>
          If you’re under the age of digital consent where you live, use Hop only with a parent’s or
          guardian’s permission.
        </p>
      </Section>

      <Section title="Changes">
        <p>If this page changes, the date at the top changes with it.</p>
      </Section>
    </main>
  );
}
