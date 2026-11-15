import type { ReactNode } from "react";
import { useReveal } from "./useReveal";

/** Eyebrow and a two-tone title: the claim in white, its payoff in grey. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  payoff,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  payoff: string;
  children?: ReactNode;
}) {
  const reveal = useReveal();
  return (
    <div {...reveal} className="mx-auto max-w-3xl text-center">
      <p className="text-[13px] font-semibold tracking-[0.18em] text-white/45 uppercase">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-4 text-[2.4rem] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-6xl"
      >
        <span className="block">{title}</span>
        <span className="block text-white/40">{payoff}</span>
      </h2>
      {children && (
        <p className="mx-auto mt-5 max-w-xl text-lg text-white/55 text-balance">{children}</p>
      )}
    </div>
  );
}
