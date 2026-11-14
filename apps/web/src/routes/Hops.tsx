import { type HopSummary, slugify } from "@hop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Radio } from "lucide-react";
import { useState } from "react";
import { RequireHandle } from "../components/RequireHandle";
import { ShareCard } from "../components/ShareCard";
import { ApiError, api } from "../lib/api";
import { displayHopUrl, formatBytes, hopUrl } from "../lib/format";

function HopsView({ handle, activeHopId }: { handle: string; activeHopId: string | null }) {
  const queryClient = useQueryClient();
  const hops = useQuery({
    queryKey: ["hops"],
    queryFn: () => api<{ hops: HopSummary[] }>("/me/hops").then((r) => r.hops),
  });
  const [title, setTitle] = useState("");
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["hops"] });
    queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const create = useMutation({
    mutationFn: () => api("/me/hops", { method: "POST", json: { title } }),
    onSuccess: () => {
      setTitle("");
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "closed" }) =>
      api(`/me/hops/${id}`, { method: "PATCH", json: { status } }),
    onSuccess: refresh,
  });
  const activate = useMutation({
    mutationFn: (id: string) => api(`/me/hops/${id}/activate`, { method: "POST" }),
    onSuccess: refresh,
  });

  const active = hops.data?.find((h) => h.id === activeHopId);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <h1 className="text-3xl font-black tracking-tight">Your Hops</h1>
      <p className="mt-2 text-black/60 dark:text-white/60">
        Make a Hop per event to keep clips apart. Your main link {displayHopUrl(hopUrl(handle))}{" "}
        uploads into whichever Hop is live.
      </p>

      {active && (
        <div className="mt-6">
          <ShareCard url={hopUrl(handle)} title={active.title} />
        </div>
      )}

      <form
        className="card mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <label className="flex-1">
          <span className="text-sm font-medium">New Hop for an event</span>
          <input
            className="input mt-2"
            placeholder="Worlds 2026"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
          {title.trim() && (
            <span className="mt-2 block text-xs text-black/50 dark:text-white/50">
              {displayHopUrl(hopUrl(handle, slugify(title)))}
            </span>
          )}
        </label>
        <button type="submit" className="btn-dark" disabled={!title.trim() || create.isPending}>
          Create
        </button>
      </form>
      {create.error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          {create.error instanceof ApiError ? create.error.message : "Couldn't create the Hop."}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {hops.data?.map((hop) => {
          const isActive = hop.id === activeHopId;
          return (
            <li key={hop.id} className="card flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  {hop.title}
                  {isActive && (
                    <span className="rounded-full bg-hop px-2 py-0.5 text-xs font-bold text-ink">
                      Live
                    </span>
                  )}
                  {hop.status === "closed" && (
                    <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs dark:bg-white/15">
                      Closed
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-sm text-black/50 dark:text-white/50">
                  {displayHopUrl(hopUrl(handle, hop.slug))} · {hop.fileCount} files ·{" "}
                  {formatBytes(hop.totalBytes)}
                </p>
              </div>
              <div className="flex gap-2">
                {!isActive && (
                  <button
                    type="button"
                    className="btn-ghost px-3 py-2"
                    onClick={() => activate.mutate(hop.id)}
                  >
                    <Radio className="size-4" /> Make live
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost px-3 py-2"
                  onClick={() =>
                    update.mutate({ id: hop.id, status: hop.status === "open" ? "closed" : "open" })
                  }
                >
                  {hop.status === "open" ? (
                    <Lock className="size-4" />
                  ) : (
                    <LockOpen className="size-4" />
                  )}
                  {hop.status === "open" ? "Close" : "Reopen"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export function Hops() {
  return (
    <RequireHandle>
      {(me) => <HopsView handle={me.handle} activeHopId={me.activeHopId} />}
    </RequireHandle>
  );
}
