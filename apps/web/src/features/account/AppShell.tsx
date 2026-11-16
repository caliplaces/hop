import { Link, useRouterState } from "@tanstack/react-router";
import { Inbox, type LucideIcon, QrCode } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { AccentScope } from "../../components/ui/AccentScope";
import { Avatar } from "../../components/ui/Avatar";
import { cx } from "../../components/ui/cx";
import { AccountDialog, type AthleteMe } from "./AccountDialog";

type Tab = {
  to: "/app" | "/app/my-hop";
  label: string;
  icon: LucideIcon;
  /** Pages that belong to the tab: an event's page is part of the inbox. */
  owns: (path: string) => boolean;
};

const TABS: Tab[] = [
  {
    to: "/app",
    label: "Inbox",
    icon: Inbox,
    owns: (path) => path === "/app" || path.startsWith("/app/events"),
  },
  {
    to: "/app/my-hop",
    label: "My Hop",
    icon: QrCode,
    owns: (path) => path.startsWith("/app/my-hop"),
  },
];

/**
 * Frame for signed-in athlete pages, as the iPhone app's: two tabs (Inbox
 * and My Hop) in a floating glass pill, at the top on wider screens and at
 * thumb's reach on phones, and the account behind the athlete's photo.
 * Chrome stays neutral; the athlete's colour is a glow behind the page and
 * the accent on real actions.
 */
export function AppShell({ me, children }: { me: AthleteMe; children: ReactNode }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const path = useRouterState({ select: (state) => state.location.pathname });

  return (
    <AccentScope
      color={me.color}
      seed={me.id}
      className="relative min-h-dvh pb-[calc(var(--tabbar-h)+2.5rem)] sm:pb-14"
    >
      <div
        aria-hidden="true"
        className="aura pointer-events-none absolute inset-x-0 top-0 h-[28rem]"
      />

      <header className="sticky top-0 z-(--z-bar)">
        <div className="relative mx-auto flex h-18 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo color={me.color} to="/app" label="Inbox" className="rounded-full" />
          <nav
            aria-label="Main"
            className="glass absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full p-1 sm:flex"
          >
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={tab.owns(path) ? "page" : undefined}
                className={cx(
                  "rounded-full px-5 py-2 text-sm font-semibold transition",
                  tab.owns(path) ? "bg-fg text-canvas" : "text-muted hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className="glass rounded-full p-1 transition active:scale-95"
            onClick={() => setAccountOpen(true)}
            aria-label="Account"
          >
            <Avatar name={me.name ?? me.handle} src={me.avatarUrl} size="sm" />
          </button>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 pt-2 sm:px-6 sm:pt-6">
        {children}
      </main>

      <nav
        aria-label="Main"
        data-tabbar
        className="fixed inset-x-0 bottom-0 z-(--z-bar) flex justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden"
      >
        <div className="glass grid w-full max-w-64 grid-cols-2 gap-1 rounded-full p-1">
          {TABS.map(({ to, label, icon: Icon, owns }) => (
            <Link
              key={to}
              to={to}
              aria-current={owns(path) ? "page" : undefined}
              className={cx(
                "flex flex-col items-center gap-0.5 rounded-full py-2 text-[11px] font-semibold transition",
                owns(path) ? "bg-fg/8 text-fg" : "text-muted",
              )}
            >
              <Icon className="size-[22px]" strokeWidth={owns(path) ? 2.2 : 1.8} />
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <AccountDialog me={me} open={accountOpen} onClose={() => setAccountOpen(false)} />
    </AccentScope>
  );
}
