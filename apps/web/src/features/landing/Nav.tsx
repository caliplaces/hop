import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "../../components/Logo";
import { cx } from "../../components/ui/cx";
import { signInUrl } from "../../lib/api";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

/** Brings the hero's waitlist form into view and focuses its email field. */
function focusWaitlist() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .getElementById("join")
    ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  document.getElementById("waitlist-hero")?.focus({ preventScroll: true });
}

export function Nav({
  launched,
  signedIn,
  joined,
}: {
  launched: boolean;
  signedIn: boolean;
  /** Already on the waitlist: no need to keep asking. */
  joined: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-(--z-bar) border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled ? "border-white/8 bg-canvas/70 backdrop-blur-xl" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <Logo />
        <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-white/60 transition hover:text-fg"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4 sm:gap-5">
          {signedIn ? (
            <Link to="/app" className="text-sm font-medium text-white/70 transition hover:text-fg">
              Open inbox
            </Link>
          ) : (
            <a
              href={signInUrl("/app")}
              className="text-sm font-medium text-white/60 transition hover:text-fg"
            >
              Sign in
            </a>
          )}
          {launched
            ? !signedIn && (
                <a
                  href={signInUrl("/app")}
                  className="btn btn-sm bg-fg text-canvas hover:opacity-90"
                >
                  Get your Hop
                </a>
              )
            : !joined && (
                <button
                  type="button"
                  onClick={focusWaitlist}
                  className="btn btn-sm bg-fg text-canvas hover:opacity-90"
                >
                  Join waitlist
                </button>
              )}
        </div>
      </div>
    </header>
  );
}
