import { colorFor } from "@hop/shared";
import type { ReactNode } from "react";
import { BRAND_COLOR, Logo } from "../../components/Logo";
import { AccentScope } from "../../components/ui/AccentScope";
import { Mascot, type MascotState } from "../mascot/Mascot";

/**
 * Full-page message told by Bobble: a missing or closed Hop, an unsubscribe…
 * In the page's colour, as a soft aura, with anything else it needs to show
 * (`top`, such as whose page it is) above Bobble.
 */
export function StatusScreen({
  mascot,
  color = BRAND_COLOR,
  title,
  children,
  action,
  top,
}: {
  mascot: MascotState;
  color?: string | null;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  top?: ReactNode;
}) {
  return (
    <AccentScope color={color} className="relative min-h-dvh">
      <div
        aria-hidden="true"
        className="aura pointer-events-none absolute inset-x-0 top-0 h-[28rem]"
      />
      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-5">
        <Logo color={color ?? undefined} />
        {top && <div className="mt-6">{top}</div>}
        <div className="animate-fade-up flex flex-1 flex-col items-center justify-center pb-24 text-center">
          <Mascot state={mascot} color={colorFor(color, "").hex} size={200} />
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 max-w-xs text-[15px] text-muted text-balance">{children}</p>
          {action && <div className="mt-6">{action}</div>}
        </div>
      </main>
    </AccentScope>
  );
}
