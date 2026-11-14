import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2 font-black tracking-tight ${className}`}
    >
      <span className="grid size-8 place-items-center rounded-xl bg-ink text-hop dark:bg-hop dark:text-ink">
        <svg viewBox="0 0 64 64" className="size-5" aria-hidden="true">
          <path d="M20 46V18h7v11h10V18h7v28h-7V35H27v11z" fill="currentColor" />
        </svg>
      </span>
      <span className="text-xl">hop</span>
    </Link>
  );
}
