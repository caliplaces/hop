import { checkHandle, type HandleProblem, normalizeHandle } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export type HandleState =
  | { kind: "empty" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "unavailable"; reason: HandleProblem | "taken" };

/** Local rules first (instant), then a debounced server check for "taken". */
export function useHandleAvailability(input: string): { handle: string; state: HandleState } {
  const handle = normalizeHandle(input);
  const [debounced, setDebounced] = useState(handle);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(handle), 300);
    return () => clearTimeout(t);
  }, [handle]);

  const localProblem = handle ? checkHandle(handle) : null;
  const remote = useQuery({
    queryKey: ["handle", debounced],
    queryFn: () => api<{ available: boolean; problem: string | null }>(`/handles/${debounced}`),
    enabled: Boolean(debounced) && !checkHandle(debounced),
    staleTime: 30_000,
  });

  let state: HandleState;
  if (!handle) state = { kind: "empty" };
  else if (localProblem) state = { kind: "unavailable", reason: localProblem };
  else if (debounced !== handle || remote.isPending) state = { kind: "checking" };
  else if (remote.data?.available) state = { kind: "available" };
  // The server's rules may be newer than this page's.
  else if (remote.data?.problem === "unavailable")
    state = { kind: "unavailable", reason: "unavailable" };
  else state = { kind: "unavailable", reason: "taken" };

  return { handle, state };
}
