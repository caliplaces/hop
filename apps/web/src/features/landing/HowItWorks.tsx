import { AtSign, Inbox, Megaphone } from "lucide-react";
import { Card } from "../../components/ui/Card";

const STEPS = [
  {
    icon: AtSign,
    title: "Claim your link",
    body: "Pick a handle and get onmyhop.com/you, plus a QR code for your phone or bib.",
  },
  {
    icon: Megaphone,
    title: "Say the line",
    body: "“Upload it on my Hop.” Friends, coaches and filmers send clips from any phone. No app, no account.",
  },
  {
    icon: Inbox,
    title: "All in one place",
    body: "Every video of you lands in one private inbox. Watch, download all, done.",
  },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how" className="py-16 sm:py-24">
      <h2
        id="how"
        className="text-center text-sm font-semibold tracking-widest text-muted uppercase"
      >
        How it works
      </h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <Card as="article" key={title} className="relative">
            <span className="absolute top-5 right-6 text-sm font-semibold text-subtle tabular-nums">
              0{i + 1}
            </span>
            <span className="grid size-11 place-items-center rounded-2xl bg-accent text-on-accent">
              <Icon className="size-5" strokeWidth={2.2} />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-[15px] text-muted">{body}</p>
          </Card>
        ))}
      </ol>
    </section>
  );
}
