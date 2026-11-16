import { Logo } from "../../components/Logo";
import { signInUrl } from "../../lib/api";

/** The one place the landing page mentions who makes Hop. */
export function Footer() {
  return (
    <footer className="border-t border-white/8 py-10 text-sm text-white/50">
      <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <Logo className="text-fg" />
          <p>
            Hop by{" "}
            <a
              href="https://caliplaces.com"
              className="text-white/70 underline-offset-4 transition hover:text-fg hover:underline"
            >
              Caliplaces
            </a>{" "}
            · © {new Date().getFullYear()}
          </p>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-6">
          <a href="#faq" className="transition hover:text-fg">
            FAQ
          </a>
          <a href="https://github.com/caliplaces/hop" className="transition hover:text-fg">
            Open source on GitHub
          </a>
          <a href={signInUrl("/app")} className="transition hover:text-fg">
            Sign in
          </a>
        </nav>
      </div>
    </footer>
  );
}
