import type { ReactNode } from "react";
import { Logo } from "./Logo";

/**
 * Who runs Hop: App Review, the GDPR and consumer law all need a name and an
 * address on the legal pages. From the Czech business register (ARES).
 */
export const OPERATOR = {
  name: "Caliplaces s.r.o.",
  address: "Uralská 689/7, Bubeneč, 160 00 Praha 6, Czech Republic",
  registration:
    "Company ID (IČO) 23311207, registered with the Municipal Court in Prague, file C 424636",
};
export const CONTACT = "hello@onmyhop.com";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-fg/85">{children}</div>
    </section>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-muted">{children}</ul>;
}

/** Hop's email address, as a link. */
export function Contact() {
  return (
    <a className="underline underline-offset-4" href={`mailto:${CONTACT}`}>
      {CONTACT}
    </a>
  );
}

/** onmyhop.com/privacy and /terms: the logo, a title, when it last changed, and the text. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 pt-6 pb-16">
      <header>
        <a href="/" aria-label="Hop home">
          <Logo />
        </a>
      </header>

      <h1 className="mt-10 text-[32px] leading-tight font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
      {children}
    </main>
  );
}
