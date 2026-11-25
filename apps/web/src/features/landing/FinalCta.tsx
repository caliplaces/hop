import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "../../components/Logo";
import { buttonClass } from "../../components/ui/Button";
import { signInUrl } from "../../lib/api";
import { StoreBadges } from "./StoreBadges";
import { useReveal } from "./useReveal";

/** Bobbles drifting around the panel's edges (percent positions, size in px). */
const CROWD = [
  { color: "coral", left: "6%", top: "14%", size: 72, delay: "0s" },
  { color: "sky", left: "86%", top: "10%", size: 64, delay: "-2s" },
  { color: "sunflower", left: "12%", top: "70%", size: 56, delay: "-4s" },
  { color: "mint", left: "82%", top: "66%", size: 76, delay: "-1s" },
  { color: "bubblegum", left: "94%", top: "40%", size: 44, delay: "-3s" },
  { color: "indigo", left: "1%", top: "44%", size: 46, delay: "-5s" },
] as const;

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  const reveal = useReveal();
  return (
    <section aria-labelledby="cta-title" className="py-16 sm:py-24">
      <div
        {...reveal}
        className="relative isolate overflow-hidden rounded-[2rem] border border-white/10 bg-[#0e0e10] px-5 py-16 text-center sm:rounded-[2.5rem] sm:px-10 sm:py-24"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_0%,rgb(124_77_255/0.28),transparent_70%),radial-gradient(50%_50%_at_50%_110%,rgb(255_107_91/0.18),transparent_70%)]"
        />
        <div aria-hidden="true" className="lp-gridlines absolute inset-0 -z-10" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 hidden md:block">
          {CROWD.map((b) => (
            <span
              key={b.color}
              className="lp-float absolute opacity-80"
              style={{
                left: b.left,
                top: b.top,
                width: b.size,
                height: b.size,
                animationDelay: b.delay,
              }}
            >
              <LogoMark color={b.color} className="size-full" />
            </span>
          ))}
        </div>

        <h2
          id="cta-title"
          className="text-[2.4rem] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-6xl"
        >
          <span className="block">Your next comp,</span>
          <span className="block text-white/40">every clip in one place.</span>
        </h2>

        <div className="mt-10 flex justify-center">
          {signedIn ? (
            <Link to="/app" className={buttonClass({ size: "lg" })}>
              Open your Hop <ArrowRight className="size-4" />
            </Link>
          ) : (
            <a href={signInUrl("/app")} className={buttonClass({ size: "lg" })}>
              Get your Hop <ArrowRight className="size-4" />
            </a>
          )}
        </div>
        <StoreBadges className="mt-6" />
      </div>
    </section>
  );
}
