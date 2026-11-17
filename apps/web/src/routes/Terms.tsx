import { PLANS } from "@hop/shared";
import { CONTACT, Contact, LegalPage, List, OPERATOR, Section } from "../components/LegalPage";
import { formatBytes } from "../lib/format";

const UPDATED = "17 November 2026";

/**
 * onmyhop.com/terms: the agreement for using Hop and paying for Hop+.
 * Written from what the code does (apps/api/README.md); keep the two in
 * step, and have a lawyer read any change.
 */
export function Terms() {
  const free = PLANS.free;
  const plus = PLANS.plus;
  return (
    <LegalPage title="Terms" updated={UPDATED}>
      <p className="mt-6 text-[15px] leading-relaxed text-fg/85">
        These terms are the agreement between you and {OPERATOR.name}, which runs Hop (onmyhop.com
        and the Hop app). They cover using Hop and paying for Hop+. How Hop handles your data is on
        the{" "}
        <a className="underline underline-offset-4" href="/privacy">
          Privacy
        </a>{" "}
        page.
      </p>

      <Section title="Who runs Hop">
        <p>
          {OPERATOR.name}, {OPERATOR.address} ({OPERATOR.registration}). Write to <Contact /> about
          anything in these terms.
        </p>
      </Section>

      <Section title="Using Hop">
        <p>
          Hop gives athletes a link (onmyhop.com/your-name) where anyone who filmed them can send
          their clips, straight to the athlete’s private inbox. To have a Hop page you sign in with
          a Caliplaces account. Sending clips needs no account.
        </p>
        <p>
          If you’re under the age of digital consent where you live, use Hop only with a parent’s or
          guardian’s permission.
        </p>
      </Section>

      <Section title="Your clips">
        <List>
          <li>
            Clips stay yours, and the filmer’s. You let Hop store them, make previews of them and
            show them to the athlete they were sent to, only to run Hop.
          </li>
          <li>
            When you send clips, you confirm you may share them and that it’s fine for the athlete
            to have them.
          </li>
          <li>
            Keep your own copies of clips that matter to you. Hop works hard to keep them safe, but
            it isn’t a backup.
          </li>
        </List>
      </Section>

      <Section title="What’s not allowed">
        <p>
          Nothing illegal, sexual content, violence, harassment, spam, or anyone else’s private
          moments without their permission. Hop may remove content that breaks these rules, hold it
          while it looks into a report, and close accounts that keep breaking them. You can report a
          clip or a page in the app or on the website, and block whoever sent it.
        </p>
      </Section>

      <Section title="Plans">
        <List>
          <li>
            Free: {formatBytes(free.storageBytes)} of storage, and clips are kept{" "}
            {free.retentionDays} days. Before any go, Hop emails you at least a week ahead, so you
            can save them.
          </li>
          <li>
            Hop+: {formatBytes(plus.storageBytes)} of storage, and clips are kept for good, for as
            long as you have it.
          </li>
        </List>
        <p>
          If Hop+ ends, nothing is removed for 30 days. After that the free plan applies again:
          older clips go, after the same email a week ahead, and while you use more than the free
          plan’s storage, new clips can’t be added.
        </p>
      </Section>

      <Section title="Hop+ on the website">
        <List>
          <li>
            You pay the price shown before you subscribe, monthly or yearly, in advance. Payments
            are handled by Stripe.
          </li>
          <li>
            When you subscribe, you agree to these terms and ask for Hop+ to start right away,
            during the 14 days you have to withdraw (below).
          </li>
          <li>
            Hop+ renews automatically at the end of each period until you cancel. Cancel anytime in
            your account on onmyhop.com (Account → Manage subscription). You keep Hop+ until the end
            of the period you paid for; the rest of a period isn’t refunded.
          </li>
          <li>
            If a payment fails, Stripe tries again for a while and Hop+ carries on meanwhile, for up
            to 16 days. If it still doesn’t go through, Hop+ ends.
          </li>
          <li>
            If the price changes, Hop emails you at least 30 days before your next payment at the
            new price, so you can cancel first.
          </li>
        </List>
      </Section>

      <Section title="Your right to withdraw">
        <p>
          If you live in the EU, you can withdraw from a Hop+ subscription bought on the website
          within 14 days of subscribing, without giving a reason. To do so, tell Hop clearly, for
          example by writing to <Contact /> from the address on your Hop account.
        </p>
        <p>
          You asked for Hop+ to start right away, so you pay for the days you had it: Hop refunds
          the rest of what you paid within 14 days of hearing from you, the same way you paid. Hop+
          ends when you withdraw.
        </p>
        <p>You can use this form, but you don’t have to:</p>
        <blockquote className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          To {OPERATOR.name}, {OPERATOR.address}, {CONTACT}: I withdraw from my Hop+ subscription,
          bought on (date). Name. Email address of my Hop account. Date.
        </blockquote>
      </Section>

      <Section title="The Hop app and Hop+ in it">
        <p>
          The Hop app for iPhone is licensed to you under Apple’s{" "}
          <a
            className="underline underline-offset-4"
            href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
          >
            standard end user license agreement
          </a>
          , along with these terms.
        </p>
        <p>
          Hop+ bought in the app is billed by Apple, under Apple’s terms. Manage or cancel it, and
          ask for refunds, in your Apple Account’s subscriptions.
        </p>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can delete your account anytime, in the app or on the website. Hop+ from the website
          is cancelled with it, at once, and the rest of the period isn’t refunded. Hop+ from the
          app isn’t: cancel it with Apple.
        </p>
      </Section>

      <Section title="If something goes wrong">
        <p>
          Hop is run with care, but it may sometimes be unavailable, and it’s provided as it is. As
          far as the law allows, {OPERATOR.name} isn’t liable for indirect losses, or for clips lost
          when you had no copy of your own. None of this limits your rights as a consumer, or
          liability that the law doesn’t allow to be limited.
        </p>
      </Section>

      <Section title="Complaints and disputes">
        <p>
          Write to <Contact /> first: most things are quickly put right. If you’re a consumer and we
          can’t agree, you can turn to the Czech Trade Inspection Authority (Česká obchodní
          inspekce,{" "}
          <a className="underline underline-offset-4" href="https://adr.coi.cz/en">
            adr.coi.cz
          </a>
          ), which settles consumer disputes out of court.
        </p>
        <p>
          Czech law applies to these terms. If you’re a consumer in another EU country, you keep the
          protection its laws give you, and you can go to court there.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change in a way that matters to you, Hop tells you by email at least 30
          days before. If you don’t agree, you can cancel Hop+ or delete your account before then.
        </p>
      </Section>
    </LegalPage>
  );
}
