import { Download, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";

/**
 * Replaces the phone tab bar while selecting (same slot, opaque), so it never
 * covers the grid. On desktop it floats at the bottom centre.
 */
export function SelectionBar({
  count,
  total,
  busy,
  onSelectAll,
  onClear,
  onDownload,
  onDelete,
  onCancel,
}: {
  count: number;
  total: number;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const allSelected = count === total && total > 0;
  return (
    <div
      data-selection-bar
      className="safe-bottom animate-fade-up fixed inset-x-0 bottom-0 z-(--z-float) border-t border-line bg-canvas px-4 pt-2 sm:bottom-6 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0"
    >
      <div className="mx-auto flex max-w-md items-center gap-2 sm:rounded-full sm:border sm:border-line sm:bg-surface sm:p-2 sm:pl-4 sm:shadow-lift">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tabular-nums">{count} selected</p>
          <button
            type="button"
            className="text-xs font-medium text-muted hover:text-fg"
            onClick={allSelected ? onClear : onSelectAll}
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <IconButton
          label="Delete selected"
          className="text-danger"
          onClick={onDelete}
          disabled={count === 0 || busy}
        >
          <Trash2 className="size-5" />
        </IconButton>
        <Button onClick={onDownload} disabled={count === 0 || busy}>
          <Download className="size-4" /> Download
        </Button>
        <Button variant="soft" onClick={onCancel}>
          Done
        </Button>
      </div>
    </div>
  );
}
