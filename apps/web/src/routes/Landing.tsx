import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleAlert } from "lucide-react";
import { Logo } from "../components/Logo";
import { AccentScope } from "../components/ui/AccentScope";
import { buttonClass } from "../components/ui/Button";
import { AmbientBackground } from "../features/landing/AmbientBackground";
import { CursorGlow } from "../features/landing/CursorGlow";
import { HowItWorks } from "../features/landing/HowItWorks";
import { PhoneMock } from "../features/landing/PhoneMock";
import { RotatingHandle } from "../features/landing/RotatingHandle";
import { SHOWCASE, showcaseAt, showcaseHex } from "../features/landing/showcase";
import { useCycle } from "../features/landing/useCycle";
import { signInUrl } from "../lib/api";
import { queries } from "../lib/queries";

const AUTH_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  expired: "Sign-in took too long. Please try again.",
  failed: "Sign-in didn't work. Please try again.",
};

export function Landing() {
  const { data: me } = useQuery(queries.me());
  const index = useCycle(SHOWCASE.length, 2400);
  const athlete = showcaseAt(index);
  const authError = new URLSearchParams(window.location.search).get("authError");
  const signedIn = Boolean(me?.handle);

  return (
    <div className="relative isolate">
      <AmbientBackground />
      <CursorGlow color={showcaseHex(index)} />
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <header className="flex h-16 items-center justify-between">
          <Logo />
          {signedIn ? (
            <Link to="/app" className={buttonClass({ variant: "soft", size: "sm" })}>
              Open inbox
            </Link>
          ) : (
            <a
              href={signInUrl("/app")}
              className="text-sm font-medium text-muted transition hover:text-fg"
            >
              Sign in
            </a>
          )}
        </header>

        {authError && (
          <p
            role="alert"
            className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 rounded-full bg-danger/10 px-4 py-2.5 text-sm text-danger"
          >
            <CircleAlert className="size-4" /> {AUTH_ERRORS[authError] ?? AUTH_ERRORS.failed}
          </p>
        )}

        <main>
          <section className="relative grid items-center gap-12 pt-8 pb-4 sm:pt-20 sm:pb-8 lg:grid-cols-[1.15fr_1fr] lg:gap-8">
            <div className="animate-fade-up text-center lg:text-left">
              <span className="badge bg-surface-2 text-muted">For athletes at events</span>
              <h1 className="mt-5 text-[44px] leading-[1.04] font-bold tracking-tighter text-balance sm:text-6xl lg:text-7xl">
                Every clip of you.
                <span className="mt-2 block text-[0.62em] tracking-tight sm:mt-3">
                  <RotatingHandle index={index} />
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-lg text-lg text-muted text-balance lg:mx-0">
                At the comp, just say “upload it on my Hop”. Everyone who filmed you sends their
                videos straight to your link. No app, no account, no chasing DMs.
              </p>
              <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                {signedIn ? (
                  <Link to="/app" className={buttonClass({ size: "lg" })}>
                    Open your Hop <ArrowRight className="size-4" />
                  </Link>
                ) : (
                  <a href={signInUrl("/app")} className={buttonClass({ size: "lg" })}>
                    Get your Hop <ArrowRight className="size-4" />
                  </a>
                )}
                <span className="text-sm text-muted">Free · Continue with Caliplaces</span>
              </div>
            </div>
            <AccentScope color={athlete.color}>
              <PhoneMock name={athlete.name} handle={athlete.handle} />
            </AccentScope>
          </section>

          <HowItWorks />
        </main>

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-line py-8 text-sm text-muted sm:flex-row">
          <span>Hop by Caliplaces</span>
          <a className="transition hover:text-fg" href="https://github.com/caliplaces/hop">
            Open source on GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
