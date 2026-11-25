import { GOOGLE_PLAY_URL } from "@hop/shared";
import { Plus } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { useReveal } from "./useReveal";

const QUESTIONS = [
  {
    q: "How do I get my Hop?",
    a: "Sign in and pick your handle. Your link, onmyhop.com/you, and its QR code are ready straight away, so claim yours before someone else does.",
  },
  {
    q: "Do the people filming me need an app or an account?",
    a: "No. They open your link or scan your QR code, pick their videos and send. It works in the browser on any iPhone or Android phone.",
  },
  {
    q: "Will my clips lose quality?",
    a: "No. Hop keeps the original files, untouched, up to 5 GB each. What they filmed is exactly what you download.",
  },
  {
    q: "Who can see my clips?",
    a: "Only you. Your inbox is private, filmers can’t see each other’s uploads, and files are kept in private storage and opened through short-lived links.",
  },
  {
    q: "Is Hop free?",
    a: "Yes, you can start for free. Hop+ adds more storage and keeps your clips for good, for athletes with a busy season.",
  },
  {
    q: "Is there an app for athletes?",
    a: GOOGLE_PLAY_URL
      ? "Yes, for iPhone and Android, though Hop works in any browser too. The app adds Event mode, which counts clips live on your Lock Screen, plus your QR code in widgets and quick controls."
      : "Yes, for iPhone, and Android’s is coming soon to Google Play. Hop works in any browser too. The app adds Event mode, which counts clips live on your Lock Screen, plus your QR code in widgets and Control Center.",
  },
  {
    q: "Is Hop open source?",
    a: "Yes. Hop is built in the open under the AGPL-3.0 licence. You can read the code, report issues or run your own on GitHub.",
  },
];

function Question({ q, a, index }: { q: string; a: string; index: number }) {
  const reveal = useReveal(index * 60);
  return (
    <li {...reveal} className="border-b border-white/10">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left text-[17px] font-medium transition hover:text-white sm:text-lg">
          {q}
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition duration-300 group-open:rotate-45 group-open:bg-white group-open:text-ink">
            <Plus className="size-4" />
          </span>
        </summary>
        <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-white/55 sm:text-base">{a}</p>
      </details>
    </li>
  );
}

export function Faq() {
  return (
    <section aria-labelledby="faq-title" id="faq" className="lp-faq scroll-mt-20 py-20 sm:py-28">
      <SectionHeading
        id="faq-title"
        eyebrow="FAQ"
        title="Before the comp."
        payoff="The usual questions."
      />
      <ul className="mx-auto mt-12 max-w-3xl border-t border-white/10">
        {QUESTIONS.map((item, i) => (
          <Question key={item.q} index={i} {...item} />
        ))}
      </ul>
    </section>
  );
}
