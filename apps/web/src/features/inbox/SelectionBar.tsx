import { Download, Trash2, X } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";

/** Floating actions while selecting; sits above the phone tab bar. */
export function SelectionBar({
  count,
  busy,
  onDownload,
  onDelete,
  onCancel,
}: {
  count: number;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="animate-fade-up fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 sm:bottom-8">
      <div className="flex w-full max-w-md items-center gap-2 rounded-full border border-line bg-surface/95 p-2 pl-3 shadow-lift backdrop-blur-xl">
        <IconButton label="Cancel selection" onClick={onCancel}>
          <X className="size-5" />
        </IconButton>
        <p className="flex-1 text-[15px] font-semibold tabular-nums">{count} selected</p>
        <IconButton
          label="Delete selected"
          className="text-danger"
          onClick={onDelete}
          disabled={count === 0}
        >
          <Trash2 className="size-5" />
        </IconButton>
        <Button variant="dark" onClick={onDownload} disabled={count === 0 || busy}>
          <Download className="size-4" /> Download
        </Button>
      </div>
    </div>
  );
}
