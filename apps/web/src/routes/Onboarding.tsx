import { type Me, normalizeHandle } from "@hop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui/Button";
import { FieldHint, PrefixedInput } from "../components/ui/Input";
import { PageSpinner, Spinner } from "../components/ui/Spinner";
import { type HandleState, useHandleAvailability } from "../features/account/useHandleAvailability";
import { ApiError, api, signInUrl } from "../lib/api";
import { queries } from "../lib/queries";

const REASONS = {
  invalid: "2–30 characters: letters, numbers, dots and underscores.",
  reserved: "That one is reserved.",
  taken: "That handle is taken.",
} as const;

function suggestHandle(me: Me): string {
  const base = normalizeHandle((me.name ?? me.email?.split("@")[0] ?? "").replace(/\s+/g, ""));
  return base.replace(/[^a-z0-9_.]/g, "").slice(0, 30);
}

function StatusHint({ state }: { state: HandleState }) {
  switch (state.kind) {
    case "unavailable":
      return <FieldHint tone="danger">{REASONS[state.reason]}</FieldHint>;
    case "available":
      return (
        <FieldHint tone="success">
          <span className="inline-flex items-center gap-1.5">
            <span className="grid size-4 place-items-center rounded-full bg-hop text-ink">
              <Check className="size-3" strokeWidth={3} />
            </span>
            Available
          </span>
        </FieldHint>
      );
    case "checking":
      return (
        <FieldHint>
          <Spinner className="size-4" />
        </FieldHint>
      );
    default:
      return <FieldHint>You get one, so pick something you’ll say out loud.</FieldHint>;
  }
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: me, isPending } = useQuery(queries.me());
  const [input, setInput] = useState("");
  const { handle, state } = useHandleAvailability(input);

  useEffect(() => {
    if (me && !input) setInput(suggestHandle(me));
  }, [me, input]);
  useEffect(() => {
    if (!isPending && me === null) window.location.assign(signInUrl());
  }, [isPending, me]);

  const claim = useMutation({
    mutationFn: () => api<{ me: Me }>("/me/handle", { method: "PUT", json: { handle } }),
    onSuccess: ({ me: updated }) => {
      queryClient.setQueryData(queries.me().queryKey, updated);
      navigate({ to: "/app" });
    },
  });

  if (isPending || !me) return <PageSpinner />;
  if (me.handle) return <Navigate to="/app" />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-5">
      <Logo />
      <div className="animate-fade-up flex flex-1 flex-col justify-center pb-24">
        <h1 className="text-[32px] leading-tight font-bold tracking-tight">Claim your Hop</h1>
        <p className="mt-2 text-[15px] text-muted">
          This is the link everyone uploads your clips to.
        </p>
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (state.kind === "available") claim.mutate();
          }}
        >
          <PrefixedInput
            prefix="onmyhop.com/"
            aria-label="Handle"
            value={input}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={30}
            onChange={(e) => setInput(e.target.value)}
          />
          {claim.error ? (
            <FieldHint tone="danger">
              {claim.error instanceof ApiError ? claim.error.message : "Couldn't save. Try again."}
            </FieldHint>
          ) : (
            <StatusHint state={state} />
          )}
          <Button
            type="submit"
            size="lg"
            className="mt-6 w-full"
            disabled={state.kind !== "available" || claim.isPending}
          >
            {claim.isPending ? "Claiming…" : "Claim it"}
          </Button>
        </form>
      </div>
    </main>
  );
}
