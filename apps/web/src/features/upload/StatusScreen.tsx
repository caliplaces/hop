import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "../../components/Logo";
import { EmptyState } from "../../components/ui/EmptyState";

/** Full-page message for a missing or closed Hop. */
export function StatusScreen({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-5">
      <Logo />
      <div className="flex flex-1 items-center justify-center pb-24">
        <EmptyState icon={icon} title={title}>
          {children}
        </EmptyState>
      </div>
    </main>
  );
}
