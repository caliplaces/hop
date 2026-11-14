import type { InboxFile } from "@hop/shared";
import { BadgeCheck } from "lucide-react";
import { cx } from "../../components/ui/cx";

/** Who sent a file; a check marks contributors who were signed in (a verified handle). */
export function ContributorLabel({ file, className }: { file: InboxFile; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="truncate">{file.contributorName ?? "Unknown"}</span>
      {file.contributorVerified && (
        <BadgeCheck className="size-3.5 shrink-0" aria-label="Signed in" />
      )}
    </span>
  );
}
