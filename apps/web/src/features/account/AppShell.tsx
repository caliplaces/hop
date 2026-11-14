import { Link } from "@tanstack/react-router";
import { Inbox, Layers, type LucideIcon, QrCode } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Logo } from "../../components/Logo";
import { Avatar } from "../../components/ui/Avatar";
import { hopUrl } from "../../lib/format";
import { QrDialog } from "../share/QrDialog";
import { AccountDialog, type AthleteMe } from "./AccountDialog";

type NavItem = { to: "/app" | "/app/hops"; label: string; icon: LucideIcon; exact: boolean };

const NAV: NavItem[] = [
  { to: "/app", label: "Inbox", icon: Inbox, exact: true },
  { to: "/app/hops", label: "Hops", icon: Layers, exact: false },
];

const tabClass =
  "flex flex-col items-center gap-1 py-1 text-[11px] font-medium text-subtle transition data-[status=active]:text-fg";

/** Frame for signed-in athlete pages: top bar, and a thumb-reach tab bar on phones. */
export function AppShell({ me, children }: { me: AthleteMe; children: ReactNode }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <div className="min-h-dvh pb-[calc(var(--tabbar-h)+2.5rem)] sm:pb-12">
      <header className="sticky top-0 z-(--z-bar) border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav
            aria-label="Main"
            className="hidden items-center gap-1 rounded-full bg-surface-2 p-1 sm:flex"
          >
            {NAV.map(({ to, label, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact }}
                className="rounded-full px-4 py-1.5 text-sm font-medium text-muted transition hover:text-fg data-[status=active]:bg-surface data-[status=active]:text-fg data-[status=active]:shadow-soft"
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className="rounded-full transition active:scale-95"
            onClick={() => setAccountOpen(true)}
            aria-label="Account"
          >
            <Avatar name={me.name ?? me.handle} size="sm" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">{children}</main>

      <nav
        aria-label="Main"
        data-tabbar
        className="safe-bottom fixed inset-x-0 bottom-0 z-(--z-bar) border-t border-line bg-canvas/90 px-6 pt-2 backdrop-blur-xl sm:hidden"
      >
        <div className="mx-auto grid max-w-sm grid-cols-3">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <Link key={to} to={to} activeOptions={{ exact }} className={tabClass}>
              <Icon className="size-6" strokeWidth={1.8} />
              {label}
            </Link>
          ))}
          <button type="button" className={tabClass} onClick={() => setQrOpen(true)}>
            <QrCode className="size-6" strokeWidth={1.8} />
            My QR
          </button>
        </div>
      </nav>

      <AccountDialog me={me} open={accountOpen} onClose={() => setAccountOpen(false)} />
      <QrDialog
        url={hopUrl(me.handle)}
        title={`@${me.handle}`}
        open={qrOpen}
        onClose={() => setQrOpen(false)}
      />
    </div>
  );
}
