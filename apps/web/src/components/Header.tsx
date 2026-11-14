import type { Me } from "@hop/shared";
import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { signInUrl, signOut } from "../lib/api";
import { Logo } from "./Logo";

export function Header({ me }: { me: Me | null | undefined }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
      <Logo />
      <nav className="flex items-center gap-2 text-sm font-medium">
        {me?.handle && (
          <>
            <Link to="/app" className="btn-ghost px-4 py-2" activeOptions={{ exact: true }}>
              Inbox
            </Link>
            <Link to="/app/hops" className="btn-ghost px-4 py-2">
              Hops
            </Link>
          </>
        )}
        {me ? (
          <button
            type="button"
            className="btn-ghost px-3 py-2"
            onClick={() => signOut()}
            title="Sign out"
          >
            <LogOut className="size-4" />
            <span className="sr-only">Sign out</span>
          </button>
        ) : (
          me === null && (
            <a href={signInUrl("/app")} className="btn-dark px-4 py-2">
              Sign in
            </a>
          )
        )}
      </nav>
    </header>
  );
}
