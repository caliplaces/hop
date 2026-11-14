import type { Me } from "@hop/shared";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { fetchMe, signInUrl } from "../lib/api";
import { Header } from "./Header";

/** Signed-in athlete with a handle; otherwise sends them to sign in or onboarding. */
export function RequireHandle({
  children,
}: {
  children: (me: Me & { handle: string }) => React.ReactNode;
}) {
  const { data: me, isPending } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  useEffect(() => {
    if (!isPending && me === null) window.location.assign(signInUrl());
  }, [isPending, me]);

  if (isPending || !me) return <Header me={undefined} />;
  if (!me.handle) return <Navigate to="/app/onboarding" />;
  return (
    <>
      <Header me={me} />
      {children(me as Me & { handle: string })}
    </>
  );
}
