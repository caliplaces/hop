import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { buttonClass } from "../../components/ui/Button";
import { signInUrl } from "../../lib/api";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { Mascot } from "../mascot/Mascot";
import { CountdownInline } from "./Countdown";
import { LAUNCH_DAY } from "./launch";
import { SHOWCASE, showcaseHex } from "./showcase";
import { useCycle } from "./useCycle";
import type { Waitlist } from "./useWaitlist";
import { WaitlistForm } from "./WaitlistForm";

const rise = (ms: number) => ({ animationDelay: `${ms}ms` }) as CSSProperties;

function LaunchBadge({ launched }: { launched: boolean }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pr-3.5 pl-3 text-[12px] font-medium whitespace-nowrap backdrop-blur min-[400px]:gap-2.5 min-[400px]:text-[13px]">
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#3DDC97] opacity-75" />
        <span className="relative size-2 rounded-full bg-[#3DDC97]" />
      </span>
      {launched ? (
        "Hop is live"
      ) : (
        <>
          <span>
            Launching <span className="min-[400px]:hidden">Dec 1</span>
            <span className="hidden min-[400px]:inline">{LAUNCH_DAY}</span>
          </span>
          <span aria-hidden="true" className="h-3 w-px bg-white/15" />
          <CountdownInline />
        </>
      )}
    </span>
  );
}

export function Hero({
  launched,
  signedIn,
  waitlist,
}: {
  launched: boolean;
  signedIn: boolean;
  waitlist: Waitlist;
}) {
  const index = useCycle(SHOWCASE.length, 3000);
  const large = useMediaQuery("(min-width: 1024px)");
  const medium = useMediaQuery("(min-width: 640px)");
  const joined = waitlist.status.kind === "joined";

  return (
    <section className="relative pt-6 pb-16 text-center sm:pt-10 sm:pb-24">
      <div className="lp-rise flex justify-center" style={rise(0)}>
        <Mascot
          color={showcaseHex(index)}
          size={large ? 230 : medium ? 200 : 168}
          state={joined ? "cheer" : "idle"}
          follow
          interactive
          label="Bobble, Hop’s mascot. Poke it!"
        />
      </div>

      <div className="lp-rise mt-1" style={rise(120)}>
        <LaunchBadge launched={launched} />
      </div>

      <h1 className="mx-auto mt-6 max-w-5xl text-[2.7rem] leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-7xl lg:text-[5.75rem]">
        <span className="lp-rise block" style={rise(200)}>
          You land the trick.
        </span>
        <span className="lp-rise block text-white/40" style={rise(320)}>
          Hop gets every clip.
        </span>
      </h1>

      <p
        className="lp-rise mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/60 text-balance sm:mt-7 sm:text-xl"
        style={rise(420)}
      >
        At the comp, just say “upload it on my Hop”. Everyone who filmed you sends their videos
        straight to your link. No app, no account, no chasing DMs.
      </p>

      <div id="join" className="lp-rise mt-8 scroll-mt-28 px-1 sm:mt-10" style={rise(520)}>
        {launched ? (
          <div className="flex flex-col items-center gap-3">
            {signedIn ? (
              <Link to="/app" className={buttonClass({ size: "lg" })}>
                Open your Hop <ArrowRight className="size-4" />
              </Link>
            ) : (
              <a href={signInUrl("/app")} className={buttonClass({ size: "lg" })}>
                Get your Hop <ArrowRight className="size-4" />
              </a>
            )}
            <span className="text-sm text-white/45">Free to start</span>
          </div>
        ) : (
          <WaitlistForm id="hero" waitlist={waitlist} />
        )}
      </div>
    </section>
  );
}
