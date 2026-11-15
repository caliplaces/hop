import { Check, Download } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "../../components/Logo";
import { useQrCode } from "../share/useQrCode";
import { RotatingHandle } from "./RotatingHandle";
import { SectionHeading } from "./SectionHeading";
import { SHOWCASE } from "./showcase";
import { ClipThumb, clipAt } from "./stage/clips";
import { useCycle } from "./useCycle";
import { useReveal } from "./useReveal";

function ClaimVisual() {
  const index = useCycle(SHOWCASE.length, 2600);
  const qr = useQrCode("https://onmyhop.com", true);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-5">
      <div className="flex h-12 w-full max-w-[17rem] items-center rounded-2xl border border-white/15 bg-black/30 px-4 text-[15px]">
        <RotatingHandle index={index} />
        <span className="ml-0.5 h-5 w-px animate-pulse bg-white/70" />
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3DDC97]/15 px-3 text-xs font-semibold text-[#3DDC97]">
          <Check className="size-3.5" strokeWidth={3} /> It’s yours
        </span>
        <span className="grid size-16 place-items-center rounded-xl bg-white p-1.5 shadow-lg">
          {qr && <img src={qr} alt="" className="size-full" />}
        </span>
      </div>
    </div>
  );
}

function SayVisual() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-5">
      <div className="flex items-end gap-3">
        <LogoMark color="coral" className="size-14" />
        <div className="relative rounded-[1.4rem] rounded-bl-md bg-white px-4 py-3 text-[15px] font-semibold text-ink shadow-xl">
          Upload it on my Hop!
        </div>
        <div aria-hidden="true" className="mb-3 flex items-end gap-[3px]">
          {[10, 18, 12, 22, 14].map((h, i) => (
            <span
              key={h}
              className="lp-wave w-[3px] rounded-full bg-white/60"
              style={{ height: h, animationDelay: `${i * 0.13}s` }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {["Coach Tomas", "SmokyMonkey441", "Mum", "Ines"].map((name) => (
          <span
            key={name}
            className="inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.06] px-3 text-xs font-medium text-white/70"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function FillVisual() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <div className="grid w-full max-w-[15rem] grid-cols-4 gap-1">
        {Array.from({ length: 8 }, (_, i) => clipAt(i + 3)).map((clip) => (
          <ClipThumb key={clip.id} clip={clip} size="sm" className="aspect-[3/4] rounded-md" />
        ))}
      </div>
      <span className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-semibold text-ink">
        <Download className="size-3.5" /> Download all
      </span>
    </div>
  );
}

const STEPS: { title: string; body: string; visual: ReactNode }[] = [
  {
    title: "Claim your link",
    body: "Pick a handle and get onmyhop.com/you, with a QR code for your phone, bag or bib.",
    visual: <ClaimVisual />,
  },
  {
    title: "Say the line",
    body: "“Upload it on my Hop.” Friends, coaches and anyone filming send clips from their phone.",
    visual: <SayVisual />,
  },
  {
    title: "Watch it fill up",
    body: "Every video of you lands in one private inbox. Watch, keep the best, download them all.",
    visual: <FillVisual />,
  },
];

function Step({ index, step }: { index: number; step: (typeof STEPS)[number] }) {
  const reveal = useReveal(index * 120);
  return (
    <li
      {...reveal}
      className="lp-spot rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-2"
    >
      <div className="h-56 overflow-hidden rounded-[1.35rem] border border-white/[0.06] bg-[radial-gradient(120%_100%_at_50%_0%,rgb(255_255_255/0.06),transparent_70%)]">
        {step.visual}
      </div>
      <div className="px-4 pt-5 pb-4">
        <span className="grid size-7 place-items-center rounded-full border border-white/15 text-[13px] font-semibold text-white/70 tabular-nums">
          {index + 1}
        </span>
        <h3 className="mt-4 text-xl font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-white/55">{step.body}</p>
      </div>
    </li>
  );
}

export function HowItWorks({ spotlight }: { spotlight: (node: HTMLElement | null) => void }) {
  return (
    <section aria-labelledby="how-title" id="how" className="scroll-mt-20 py-20 sm:py-28">
      <SectionHeading
        id="how-title"
        eyebrow="How it works"
        title="Claim it. Say it."
        payoff="Watch it fill up."
      />
      <ol ref={spotlight} className="mt-14 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <Step key={step.title} index={i} step={step} />
        ))}
      </ol>
    </section>
  );
}
