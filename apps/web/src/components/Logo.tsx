import { Link } from "@tanstack/react-router";

/** Placeholder mark until the final logo lands; swap the SVG here only. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <span className={`grid place-items-center rounded-[30%] bg-fg text-canvas ${className}`}>
      <svg viewBox="0 0 64 64" className="size-[62%]" aria-hidden="true">
        <path d="M18 50V14h9v14h10V14h9v36h-9V36H27v14z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 ${className}`} aria-label="Hop home">
      <LogoMark />
      <span className="text-xl font-bold tracking-tight">hop</span>
    </Link>
  );
}
