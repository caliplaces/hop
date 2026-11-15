import { colorFor } from "@hop/shared";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../../../lib/useMediaQuery";
import { FILMERS, filmerAt, STAGE_ATHLETE } from "../showcase";
import { ClipThumb, clipAt } from "./clips";
import { PHONE, PhoneInbox } from "./PhoneInbox";
import { Scaled } from "./Scaled";
import {
  ArrivalNotice,
  DigestEmail,
  type FilmerState,
  LiveActivity,
  UploadCard,
} from "./StageCards";

const BEAT_MS = 2800;
const BASE_CLIPS = 35;
const PEOPLE = 14;

/**
 * Counts up one beat at a time while the stage is on screen and the tab is
 * visible. Stays at 0 with reduced motion, which leaves a still scene.
 */
function useBeat(target: RefObject<HTMLElement | null>) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const node = target.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearInterval(id);
      if (entry?.isIntersecting) {
        id = setInterval(() => !document.hidden && setBeat((b) => b + 1), BEAT_MS);
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearInterval(id);
    };
  }, [target]);
  return beat;
}

function filmerState(index: number, beat: number): FilmerState {
  if (index === beat % FILMERS.length) return "sending";
  return beat > index ? "sent" : "waiting";
}

/*
 * The desktop scene, on a 1200 × 680 canvas: filmers on the left send clips
 * along the dashed lines into Maya's inbox; on the right, what she sees.
 */
const SCENE = { width: 1200, height: 680 };
const PHONE_AT = { x: 450, y: 60 };
const CARDS_Y = [116, 276, 436];
const CARD_RIGHT = 340;
const CARD_MID = 66;
const FIRST_TILE = { x: 509, y: 290 };

const pathFrom = (y: number) =>
  `M ${CARD_RIGHT} ${y} C ${CARD_RIGHT + 70} ${y}, ${FIRST_TILE.x - 120} ${FIRST_TILE.y}, ${FIRST_TILE.x} ${FIRST_TILE.y}`;

function DesktopScene({ beat }: { beat: number }) {
  const active = beat % FILMERS.length;
  const last = filmerAt(beat - 1);
  const total = BASE_CLIPS + beat;
  return (
    <div className="relative" style={SCENE}>
      <svg
        className="absolute inset-0"
        width={SCENE.width}
        height={SCENE.height}
        aria-hidden="true"
        fill="none"
      >
        {CARDS_Y.map((y, i) => (
          <path
            key={y}
            d={pathFrom(y + CARD_MID)}
            stroke="white"
            strokeOpacity={i === active ? 0.35 : 0.1}
            strokeWidth={1.5}
            strokeDasharray="3 6"
            className="transition-[stroke-opacity] duration-700"
          />
        ))}
        {[176, 340, 480].map((y) => (
          <path
            key={y}
            d={`M ${PHONE_AT.x + PHONE.width} ${y < 300 ? 250 : 320} C 790 ${y < 300 ? 250 : 320}, 790 ${y}, 840 ${y}`}
            stroke="white"
            strokeOpacity={0.1}
            strokeWidth={1.5}
            strokeDasharray="3 6"
          />
        ))}
      </svg>

      {FILMERS.map((filmer, i) => (
        <UploadCard
          key={filmer.name}
          filmer={filmer}
          state={filmerState(i, beat)}
          run={beat}
          className={`absolute ${i === active ? "opacity-100" : "opacity-70"}`}
          style={{ left: 60, top: CARDS_Y[i] }}
        />
      ))}

      <div className="absolute" style={{ left: PHONE_AT.x, top: PHONE_AT.y }}>
        <PhoneInbox arrived={beat} total={total} />
      </div>

      {/* The clip being sent travels the active dashed line into the inbox. */}
      <ClipThumb
        key={beat}
        clip={clipAt(beat + 14)}
        size="sm"
        className="lp-travel absolute top-0 left-0 h-10 w-[30px] rounded-md shadow-lg ring-1 ring-white/30"
        style={{ offsetPath: `path("${pathFrom((CARDS_Y[active] ?? 0) + CARD_MID)}")` }}
      />

      <div className="absolute" style={{ left: 840, top: 104 }}>
        <LiveActivity total={total} people={PEOPLE} />
      </div>
      <div className="absolute" style={{ left: 840, top: 292 }}>
        <ArrivalNotice from={last.name} count={1 + ((beat * 2) % 3)} />
      </div>
      <div className="absolute" style={{ left: 840, top: 412 }}>
        <DigestEmail />
      </div>
    </div>
  );
}

/** Phones get the inbox with one filmer and a notification over it. */
function MobileScene({ beat }: { beat: number }) {
  const active = beat % FILMERS.length;
  const filmer = filmerAt(active);
  const last = filmerAt(beat - 1);
  return (
    <div className="relative" style={{ width: 380, height: 600 }}>
      <div className="absolute" style={{ left: 40, top: 0 }}>
        <PhoneInbox arrived={beat} total={BASE_CLIPS + beat} />
      </div>
      <div className="absolute" style={{ left: 40, top: 58 }}>
        <ArrivalNotice from={last.name} count={1 + ((beat * 2) % 3)} />
      </div>
      <UploadCard
        filmer={filmer}
        state="sending"
        run={beat}
        className="lp-float absolute"
        style={{ left: 0, top: 420 }}
      />
    </div>
  );
}

export function ProductStage() {
  const ref = useRef<HTMLDivElement>(null);
  const beat = useBeat(ref);
  const wide = useMediaQuery("(min-width: 768px)");
  const accent = colorFor(STAGE_ATHLETE.color, "").hex;

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c0c0e] sm:rounded-[2.5rem]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="lp-gridlines absolute inset-0" />
        {[
          { left: "-6%", beam: "#7C4DFF", delay: "0s" },
          { left: "27%", beam: accent, delay: "-3.3s" },
          { left: "60%", beam: "#38BDF8", delay: "-6.6s" },
        ].map((b) => (
          <div
            key={b.left}
            className="lp-beam"
            style={{ left: b.left, "--beam": b.beam, animationDelay: b.delay } as CSSProperties}
          />
        ))}
        <div
          className="absolute inset-x-0 bottom-0 h-2/3"
          style={{
            background: `radial-gradient(60% 70% at 50% 100%, ${accent}33, transparent 70%)`,
          }}
        />
      </div>

      <p className="sr-only">
        Three people send their clips of Maya from their phones. Each clip lands in Maya’s Hop
        inbox, her Lock Screen counts them live, and she gets a notification and a digest email.
      </p>
      <div aria-hidden="true" className="relative px-3 pt-8 sm:px-8 sm:pt-12">
        {wide ? (
          <Scaled {...SCENE}>
            <DesktopScene beat={beat} />
          </Scaled>
        ) : (
          <Scaled width={380} height={600}>
            <MobileScene beat={beat} />
          </Scaled>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0c0c0e] to-transparent" />
    </div>
  );
}
