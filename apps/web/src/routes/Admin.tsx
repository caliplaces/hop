import type { AdminStats, Recent } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Logo } from "../components/Logo";
import { buttonClass } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageSpinner } from "../components/ui/Spinner";
import { StatusScreen } from "../features/upload/StatusScreen";
import { api } from "../lib/api";

const number = new Intl.NumberFormat("en-GB");

/** "1.24 GB", "540 MB": stored bytes, in the units people think in. */
function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit >= 3 ? 2 : 0)} ${units[unit]}`;
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <Card as="div" className="flex flex-col gap-1">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
      {children && <span className="text-sm text-muted tabular-nums">{children}</span>}
    </Card>
  );
}

/** "+2 in 24 hours · +5 in 7 days · +9 in 30 days": rolling, not calendar, periods. */
function recent({ day, week, month }: Recent, verb = "+") {
  return `${verb}${number.format(day)} in 24 hours · ${verb}${number.format(week)} in 7 days · ${verb}${number.format(month)} in 30 days`;
}

/**
 * onmyhop.com/admin: Hop's numbers, for Hop's team only. Everyone else gets
 * the same "nothing here" as any unknown page.
 */
export function Admin() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api<AdminStats>("/admin/stats"),
    retry: false,
    refetchOnWindowFocus: true,
  });

  if (stats.isPending) return <PageSpinner />;
  // Signed out or not on the team: the same as any unknown page.
  if (stats.error) {
    return (
      <StatusScreen mascot="broken" title="Nothing here">
        There’s no page at this address.
      </StatusScreen>
    );
  }

  const s = stats.data;
  const updated = new Date(s.generatedAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-16">
      <header className="flex items-center justify-between">
        <a href="/" aria-label="Hop home">
          <Logo />
        </a>
        <button
          type="button"
          className={buttonClass({ variant: "soft", size: "sm" })}
          onClick={() => stats.refetch()}
          disabled={stats.isFetching}
        >
          {stats.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <h1 className="mt-10 text-3xl font-bold tracking-tight">Hop’s numbers</h1>
      <p className="mt-1 text-sm text-muted">As of {updated}. Counts only, nobody in particular.</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Athletes" value={number.format(s.athletes.total)}>
          {recent(s.athletes.new)}
        </Stat>
        <Stat label="Active athletes, last 7 days" value={number.format(s.athletes.active.week)}>
          At least · {number.format(s.athletes.active.day)} in 24 hours ·{" "}
          {number.format(s.athletes.active.month)} in 30 days
        </Stat>
        <Stat label="People who sent clips, last 7 days" value={number.format(s.senders.week)}>
          {number.format(s.senders.day)} in 24 hours · {number.format(s.senders.month)} in 30 days
        </Stat>
        <Stat label="Events" value={number.format(s.events.total)}>
          {recent(s.events.new)}
        </Stat>
        <Stat label="Clips" value={number.format(s.clips.total)}>
          {recent(s.clips.new)}
        </Stat>
        <Stat label="Stored" value={size(s.storage.bytes)}>
          {size(s.storage.freeBytes)} free plan · {size(s.storage.plusBytes)} Hop+
          {s.storage.pendingBytes > 0 && ` · ${size(s.storage.pendingBytes)} uploading`}
        </Stat>
        <Stat label="Hop+ subscribers" value={number.format(s.plus.subscribers)} />
        <Stat label="On the waitlist" value={number.format(s.waitlist)} />
        <Stat label="Deleted accounts" value={number.format(s.athletes.deleted)} />
      </div>

      <h2 className="mt-12 text-lg font-semibold tracking-tight">The last 30 days</h2>
      <Card flush className="mt-3 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Day</th>
              <th className="px-4 py-3 text-right font-medium">New athletes</th>
              <th className="px-4 py-3 text-right font-medium">New events</th>
              <th className="px-4 py-3 text-right font-medium">Clips</th>
              <th className="px-4 py-3 text-right font-medium">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {[...s.daily].reverse().map((row) => (
              <tr key={row.day} className="border-t border-line">
                <td className="px-4 py-2.5">
                  {new Date(`${row.day}T00:00:00Z`).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </td>
                <td className="px-4 py-2.5 text-right">{number.format(row.athletes)}</td>
                <td className="px-4 py-2.5 text-right">{number.format(row.events)}</td>
                <td className="px-4 py-2.5 text-right">{number.format(row.clips)}</td>
                <td className="px-4 py-2.5 text-right">{row.bytes ? size(row.bytes) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
