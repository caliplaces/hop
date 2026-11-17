import { type ColorId, colorFor, type Me, normalizeHandle } from "@hop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { AccentScope } from "../components/ui/AccentScope";
import { Button } from "../components/ui/Button";
import { FieldHint, PrefixedInput } from "../components/ui/Input";
import { PageSpinner, Spinner } from "../components/ui/Spinner";
import { ColorPicker } from "../features/account/ColorPicker";
import { type HandleState, useHandleAvailability } from "../features/account/useHandleAvailability";
import { Mascot } from "../features/mascot/Mascot";
import { ApiError, api, signInUrl } from "../lib/api";
import { queries } from "../lib/queries";

const REASONS = {
  invalid: "2–30 characters: letters, numbers, dots and underscores.",
  reserved: "That one is reserved.",
  unavailable: "That handle isn't available.",
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
            <span className="grid size-4 place-items-center rounded-full bg-accent text-on-accent">
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
  const [color, setColor] = useState<ColorId | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const pendingFinish = useRef<{ timer: ReturnType<typeof setTimeout>; me: Me } | null>(null);
  const pickedColor: ColorId | undefined = color ?? (me ? colorFor(me.color, me.id).id : undefined);
  const { handle, state } = useHandleAvailability(input);

  useEffect(() => {
    if (me && !input) setInput(suggestHandle(me));
  }, [me, input]);
  useEffect(() => {
    if (!isPending && me === null) window.location.assign(signInUrl());
  }, [isPending, me]);

  const claim = useMutation({
    mutationFn: () =>
      api<{ me: Me }>("/me/handle", { method: "PUT", json: { handle, color: pickedColor } }),
    onSuccess: ({ me: updated }) => {
      // Let Bobble celebrate before moving on (updating the cache redirects).
      setCelebrating(true);
      const timer = setTimeout(() => {
        pendingFinish.current = null;
        queryClient.setQueryData(queries.me().queryKey, updated);
        navigate({ to: "/app" });
      }, 1300);
      pendingFinish.current = { timer, me: updated };
    },
  });

  // Leaving during the celebration: skip the redirect, but keep the new account.
  useEffect(
    () => () => {
      const pending = pendingFinish.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      queryClient.setQueryData(queries.me().queryKey, pending.me);
    },
    [queryClient],
  );

  if (isPending || !me) return <PageSpinner />;
  if (me.handle) return <Navigate to="/app" />;

  return (
    <AccentScope color={pickedColor} seed={me.id}>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-5">
        <Logo color={pickedColor} />
        <div className="animate-fade-up pt-4 sm:pt-10">
          {pickedColor && (
            <div className="flex justify-center">
              <Mascot
                state={celebrating ? "cheer" : "idle"}
                color={colorFor(pickedColor, me.id).hex}
                size={168}
                follow
                interactive
                label="Bobble, wearing your colour"
              />
            </div>
          )}
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
                {claim.error instanceof ApiError
                  ? claim.error.message
                  : "Couldn't save. Try again."}
              </FieldHint>
            ) : (
              <StatusHint state={state} />
            )}

            {pickedColor && (
              <div className="mt-8">
                <p className="text-[15px] font-semibold">Pick your colour</p>
                <p className="text-sm text-muted">Bobble and your upload page wear it.</p>
                <div className="mt-4">
                  <ColorPicker value={pickedColor} onChange={setColor} />
                </div>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="mt-8 w-full"
              disabled={state.kind !== "available" || claim.isPending || celebrating}
            >
              {celebrating ? "It’s yours! 🎉" : claim.isPending ? "Claiming…" : "Claim it"}
            </Button>
          </form>
        </div>
      </main>
    </AccentScope>
  );
}
