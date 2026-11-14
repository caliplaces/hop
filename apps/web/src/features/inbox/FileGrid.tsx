import type { InboxFile } from "@hop/shared";
import type { ReactNode } from "react";
import { FileTile } from "./FileTile";

const GRID = "grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6";

export function FileGridSkeleton() {
  return (
    <ul className={GRID} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <li key={i} className="skeleton aspect-[4/5] rounded-2xl sm:rounded-3xl" />
      ))}
    </ul>
  );
}

export function FileGrid({
  files,
  selecting,
  selected,
  onOpen,
  onToggle,
  footer,
}: {
  files: InboxFile[];
  selecting: boolean;
  selected: Set<string>;
  onOpen: (file: InboxFile) => void;
  onToggle: (id: string) => void;
  footer?: ReactNode;
}) {
  return (
    <>
      <ul className={GRID}>
        {files.map((file) => (
          <FileTile
            key={file.id}
            file={file}
            selecting={selecting}
            selected={selected.has(file.id)}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </ul>
      {footer}
    </>
  );
}
