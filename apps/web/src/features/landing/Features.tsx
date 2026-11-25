import { COLOR_IDS, colorFor } from "@hop/shared";
import { ChevronRight, Lock, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "../../components/Logo";
import { cx } from "../../components/ui/cx";
import { SectionHeading } from "./SectionHeading";
import { STAGE_ATHLETE, STAGE_EVENT } from "./showcase";
import { ClipThumb, clipAt } from "./stage/clips";
import { useReveal } from "./useReveal";

function Tile({
  title,
  body,
  visual,
  wide,
  index,
}: {
  title: string;
  body: string;
  visual: ReactNode;
  wide?: boolean;
  index: number;
}) {
  const reveal = useReveal((index % 3) * 100);
  return (
    <li
      {...reveal}
      className={cx(
        "lp-spot flex flex-col rounded-[1.75rem] border border-white/10 bg-white/[0.025] p-2",
        wide && "md:col-span-2",
      )}
    >
      <div className="relative h-52 overflow-hidden rounded-[1.35rem] border border-white/[0.06] bg-[radial-gradient(120%_100%_at_50%_0%,rgb(255_255_255/0.05),transparent_70%)] sm:h-56">
        {visual}
      </div>
      <div className="px-4 pt-5 pb-4">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-white/55">{body}</p>
      </div>
    </li>
  );
}

const FILES = [
  { name: "IMG_4821.MOV", meta: "4K · 60 fps · HDR", size: "1.8 GB", clip: 2 },
  { name: "PXL_20261201_1849.mp4", meta: "4K · 30 fps", size: "742 MB", clip: 5 },
  { name: "IMG_0937.MOV", meta: "1080p · 240 fps slo-mo", size: "2.4 GB", clip: 8 },
];

function QualityVisual() {
  return (
    <div className="flex h-full items-center gap-6 px-5 sm:px-8">
      <ul className="flex-1 space-y-2">
        {FILES.map((file) => (
          <li
            key={file.name}
            className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/30 p-2 pr-3 max-sm:last:hidden"
          >
            <ClipThumb
              clip={clipAt(file.clip)}
              size="sm"
              className="h-11 w-9 shrink-0 rounded-lg"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-semibold">{file.name}</p>
              <p className="mt-0.5 text-[11px] text-white/45">{file.meta}</p>
            </div>
            <span className="text-[12px] text-white/55 tabular-nums">{file.size}</span>
          </li>
        ))}
      </ul>
      <div className="hidden text-center sm:block">
        <p className="text-6xl font-semibold tracking-[-0.05em]">5 GB</p>
        <p className="mt-1 text-sm text-white/45">per file, untouched</p>
      </div>
    </div>
  );
}

function NoAppVisual() {
  const accent = colorFor(STAGE_ATHLETE.color, "").hex;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <div className="flex h-9 w-full max-w-[15rem] items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] text-[13px] text-white/70">
        <Lock className="size-3" /> onmyhop.com/{STAGE_ATHLETE.handle}
      </div>
      <span
        className="inline-flex h-11 w-full max-w-[15rem] items-center justify-center rounded-full text-[14px] font-semibold text-ink"
        style={{ backgroundColor: accent }}
      >
        Choose videos
      </span>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-white/50">
        Sending as <span className="font-semibold text-white/80">SmokyMonkey441</span>
        <RefreshCw className="size-3" />
      </span>
    </div>
  );
}

const EVENTS = [
  { title: STAGE_EVENT, slug: "prague-open", clips: 38, color: "coral" },
  { title: "Summer Jam", slug: "summer-jam", clips: 21, color: "sky" },
  { title: "Street Workout Cup", slug: "sw-cup", clips: 12, color: "mint" },
] as const;

function EventsVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-5">
      {EVENTS.map((event, i) => (
        <div
          key={event.slug}
          className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/30 p-2.5 pr-3"
          style={{ opacity: 1 - i * 0.22 }}
        >
          <span
            className="size-8 shrink-0 rounded-xl"
            style={{ backgroundColor: colorFor(event.color, "").hex }}
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold">{event.title}</p>
            <p className="truncate text-[11px] text-white/45">/maya/{event.slug}</p>
          </div>
          <span className="text-[12px] text-white/55 tabular-nums">{event.clips}</span>
          <ChevronRight className="size-3.5 text-white/30" />
        </div>
      ))}
    </div>
  );
}

function LockScreenVisual() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5">
      <p className="text-5xl font-semibold tracking-tight text-white/85 tabular-nums">18:42</p>
      <p className="mt-1 text-[12px] text-white/45">Saturday, December 12</p>
      <div className="mt-4 flex w-full max-w-[16rem] items-center gap-3 rounded-[1.4rem] bg-black/60 p-3 ring-1 ring-white/10">
        <LogoMark color={STAGE_ATHLETE.color} className="size-9" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold">{STAGE_EVENT}</p>
          <p className="text-[11px] text-white/45">Event mode</p>
        </div>
        <p className="text-2xl font-bold tabular-nums">38</p>
      </div>
    </div>
  );
}

function PrivateVisual() {
  return (
    <div className="relative grid h-full place-items-center">
      <div className="absolute inset-4 grid grid-cols-4 gap-1.5 opacity-60 blur-[6px]">
        {Array.from({ length: 8 }, (_, i) => clipAt(i + 9)).map((clip) => (
          <ClipThumb key={clip.id} clip={clip} size="sm" className="rounded-lg" />
        ))}
      </div>
      <div className="relative flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-5 py-4 ring-1 ring-white/10 backdrop-blur-md">
        <span className="grid size-10 place-items-center rounded-full bg-white text-ink">
          <Lock className="size-4" strokeWidth={2.5} />
        </span>
        <p className="text-[13px] font-semibold">Only {STAGE_ATHLETE.name} can see these</p>
      </div>
    </div>
  );
}

function ColoursVisual() {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="grid grid-cols-6 gap-1 sm:gap-2">
        {COLOR_IDS.map((id, i) => (
          // Each one bobs on its own beat.
          <span key={id} className="lp-float" style={{ animationDelay: `${-i * 0.55}s` }}>
            <LogoMark
              color={id}
              className="size-12 transition-transform duration-300 hover:-translate-y-1 hover:scale-110 sm:size-16"
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function ZipVisual() {
  return (
    <div className="flex h-full flex-col justify-center px-6">
      <div className="rounded-2xl border border-white/8 bg-black/30 p-4">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-semibold">maya-prague-open.zip</span>
          <span className="text-white/45 tabular-nums">6.4 GB</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[72%] rounded-full bg-white" />
        </div>
        <p className="mt-2 text-[11px] text-white/45">38 clips · originals</p>
      </div>
    </div>
  );
}

const TILES = [
  {
    title: "Every clip in original quality",
    body: "No group-chat compression, no screen recordings of stories. Clips arrive exactly as they were filmed.",
    visual: <QualityVisual />,
    wide: true,
  },
  {
    title: "No app. No account.",
    body: "Filmers open your link in any phone browser and send. They can add a name or stay SmokyMonkey441.",
    visual: <NoAppVisual />,
  },
  {
    title: "A Hop for every event",
    body: "Give each comp its own link and QR code, and its clips stay together.",
    visual: <EventsVisual />,
  },
  {
    title: "Live on your Lock Screen",
    body: "Event mode in the app counts clips as they land, even with your phone in your bag.",
    visual: <LockScreenVisual />,
  },
  {
    title: "Yours alone",
    body: "Only you can see your inbox. Filmers can’t see each other’s clips, and files sit in private storage.",
    visual: <PrivateVisual />,
  },
  {
    title: "Make it yours",
    body: "Pick one of twelve colours. Your page, your QR code and Bobble all wear it.",
    visual: <ColoursVisual />,
    wide: true,
  },
  {
    title: "Download everything",
    body: "Save one clip, or a whole event as a single .zip with every original inside.",
    visual: <ZipVisual />,
  },
];

export function Features({ spotlight }: { spotlight: (node: HTMLElement | null) => void }) {
  return (
    <section aria-labelledby="features-title" id="features" className="scroll-mt-20 py-20 sm:py-28">
      <SectionHeading
        id="features-title"
        eyebrow="Features"
        title="Built for comp day."
        payoff="Not for group chats."
      />
      <ul ref={spotlight} className="mt-14 grid gap-4 md:grid-cols-3">
        {TILES.map((tile, i) => (
          <Tile key={tile.title} index={i} {...tile} />
        ))}
      </ul>
    </section>
  );
}
