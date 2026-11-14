import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { PageSpinner } from "../../components/ui/Spinner";
import { signInUrl } from "../../lib/api";
import { queries } from "../../lib/queries";
import type { AthleteMe } from "./AccountDialog";
import { AppShell } from "./AppShell";

/** Signed-in athlete with a handle; otherwise sends them to sign in or onboarding. */
export function RequireAthlete({ children }: { children: (me: AthleteMe) => ReactNode }) {
  const { data: me, isPending } = useQuery(queries.me());

  useEffect(() => {
    if (!isPending && me === null) window.location.assign(signInUrl());
  }, [isPending, me]);

  if (isPending || !me) return <PageSpinner />;
  if (!me.handle) return <Navigate to="/app/onboarding" />;
  const athlete = me as AthleteMe;
  return <AppShell me={athlete}>{children(athlete)}</AppShell>;
}
