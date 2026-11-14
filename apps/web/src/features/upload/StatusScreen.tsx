import { colorFor } from "@hop/shared";
import type { ReactNode } from "react";
import { BRAND_COLOR, Logo } from "../../components/Logo";
import { Mascot, type MascotState } from "../mascot/Mascot";

/** Full-page message for a missing or closed Hop, told by Bobble. */
export function StatusScreen({
  mascot,
  color = BRAND_COLOR,
  title,
  children,
}: {
  mascot: MascotState;
  color?: string | null;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-5">
      <Logo color={color ?? undefined} />
      <div className="animate-fade-up flex flex-1 flex-col items-center justify-center pb-24 text-center">
        <Mascot state={mascot} color={colorFor(color, "").hex} size={200} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-xs text-[15px] text-muted text-balance">{children}</p>
      </div>
    </main>
  );
}
