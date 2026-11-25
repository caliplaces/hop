import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { AmbientBackground } from "../features/landing/AmbientBackground";
import { CursorGlow } from "../features/landing/CursorGlow";
import { Faq } from "../features/landing/Faq";
import { Features } from "../features/landing/Features";
import { FinalCta } from "../features/landing/FinalCta";
import { Footer } from "../features/landing/Footer";
import { Hero } from "../features/landing/Hero";
import { HowItWorks } from "../features/landing/HowItWorks";
import { Marquee } from "../features/landing/Marquee";
import { Nav } from "../features/landing/Nav";
import { ProductStage } from "../features/landing/stage/ProductStage";
import { useSpotlight } from "../features/landing/useSpotlight";
import { usePageTheme } from "../lib/pageTheme";
import { queries } from "../lib/queries";
import "../features/landing/landing.css";

const AUTH_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  expired: "Sign-in took too long. Please try again.",
  failed: "Sign-in didn't work. Please try again.",
};

export function Landing() {
  usePageTheme("dark");
  const { data: me } = useQuery(queries.me());
  const signedIn = Boolean(me?.handle);
  const spotlightSteps = useSpotlight();
  const spotlightTiles = useSpotlight();
  const authError = new URLSearchParams(window.location.search).get("authError");

  return (
    <div className="lp relative isolate overflow-x-clip">
      <div aria-hidden="true" className="lp-grain pointer-events-none fixed inset-0 -z-10" />
      <div
        aria-hidden="true"
        className="lp-gridlines pointer-events-none absolute inset-x-0 top-0 -z-10 h-[56rem]"
      />
      <AmbientBackground />
      <CursorGlow color="#7C4DFF" />

      <Nav signedIn={signedIn} />

      {authError && (
        <p
          role="alert"
          className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 rounded-full bg-danger/10 px-4 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="size-4" /> {AUTH_ERRORS[authError] ?? AUTH_ERRORS.failed}
        </p>
      )}

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <Hero signedIn={signedIn} />
        <ProductStage />
        <Marquee />
        <HowItWorks spotlight={spotlightSteps} />
        <Features spotlight={spotlightTiles} />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>

      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <Footer />
      </div>
    </div>
  );
}
