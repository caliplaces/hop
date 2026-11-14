import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Centered message for empty or error states, with an icon or custom art (e.g. Bobble). */
export function EmptyState({
  icon: Icon,
  art,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  art?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fade-up flex flex-col items-center px-6 py-12 text-center">
      {art ??
        (Icon && (
          <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-muted">
            <Icon className="size-7" strokeWidth={1.8} />
          </span>
        ))}
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
      {children && <p className="mt-2 max-w-sm text-[15px] text-muted text-balance">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
