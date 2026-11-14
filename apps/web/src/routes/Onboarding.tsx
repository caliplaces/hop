import { checkHandle, type Me, normalizeHandle } from "@hop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { ApiError, api, fetchMe, signInUrl } from "../lib/api";

const PROBLEMS: Record<string, string> = {
  invalid: "2–30 characters: letters, numbers, dots and underscores.",
  reserved: "That one is reserved.",
  taken: "That handle is taken.",
};

function suggestHandle(me: Me): string {
  const base = normalizeHandle((me.name ?? me.email?.split("@")[0] ?? "").replace(/\s+/g, ""));
  return base.replace(/[^a-z0-9_.]/g, "").slice(0, 30);
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: me, isPending } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [handle, setHandle] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (me && !handle) setHandle(suggestHandle(me));
  }, [me, handle]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(normalizeHandle(handle)), 300);
    return () => clearTimeout(t);
  }, [handle]);
  useEffect(() => {
    if (!isPending && me === null) window.location.assign(signInUrl());
  }, [isPending, me]);

  const localProblem = debounced ? checkHandle(debounced) : null;
  const availability = useQuery({
    queryKey: ["handle", debounced],
    queryFn: () => api<{ available: boolean; problem: string | null }>(`/handles/${debounced}`),
    enabled: Boolean(debounced) && !localProblem,
  });

  const claim = useMutation({
    mutationFn: () => api<{ me: Me }>("/me/handle", { method: "PUT", json: { handle } }),
    onSuccess: ({ me: updated }) => {
      queryClient.setQueryData(["me"], updated);
      navigate({ to: "/app" });
    },
  });

  if (me?.handle) return <Navigate to="/app" />;

  const problem = localProblem ?? availability.data?.problem ?? null;
  const ready =
    Boolean(debounced) &&
    !problem &&
    availability.data?.available === true &&
    debounced === normalizeHandle(handle);

  return (
    <>
      <Header me={me} />
      <main className="mx-auto max-w-md px-5 pt-10">
        <h1 className="text-4xl font-black tracking-tight">Claim your Hop</h1>
        <p className="mt-2 text-black/60 dark:text-white/60">
          This is the link people upload to. You get one, so pick something you’ll say out loud.
        </p>
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) claim.mutate();
          }}
        >
          <div className="input flex items-center gap-0 p-0 focus-within:border-ink dark:focus-within:border-paper">
            <span className="pl-4 text-black/50 dark:text-white/50">onmyhop.com/</span>
            <input
              className="min-w-0 flex-1 bg-transparent py-3 pr-4 outline-none"
              value={handle}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={30}
              onChange={(e) => setHandle(e.target.value)}
              aria-label="Handle"
            />
          </div>
          <p className="mt-2 h-5 text-sm">
            {problem ? (
              <span className="text-red-600 dark:text-red-400">
                {PROBLEMS[problem] ?? "Not available."}
              </span>
            ) : ready ? (
              <span className="text-green-700 dark:text-hop">Available</span>
            ) : null}
          </p>
          {claim.error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {claim.error instanceof ApiError ? claim.error.message : "Couldn't save. Try again."}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary mt-4 w-full py-4 text-base"
            disabled={!ready || claim.isPending}
          >
            {claim.isPending ? "Saving…" : "Claim it"}
          </button>
        </form>
      </main>
    </>
  );
}
