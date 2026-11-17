import { X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { IconButton } from "./Button";
import { useModalDialog } from "./useModalDialog";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Wider dialogs on desktop; still a full-width sheet on phones. */
  size?: "sm" | "md" | "lg";
  hideClose?: boolean;
  /**
   * "side": a panel along the right edge on larger screens, as the app's
   * account sheet (still a sheet from the bottom on phones).
   */
  placement?: "center" | "side";
};

const widths = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-xl" };

/**
 * Native <dialog>: focus trapping, Esc and inert background come from the
 * browser. Slides up as a sheet on phones, centred card on larger screens.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  hideClose,
  placement = "center",
}: Props) {
  const side = placement === "side";
  const ref = useModalDialog(open);
  const titleId = useId();
  const descriptionId = useId();

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Esc closes natively
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside the panel).
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      className={
        side
          ? `m-0 mt-auto w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-black/30 backdrop:backdrop-blur-sm sm:my-0 sm:mr-0 sm:ml-auto sm:h-dvh sm:max-h-dvh sm:p-3 ${widths[size]}`
          : `m-0 mt-auto w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-black/40 backdrop:backdrop-blur-sm sm:m-auto ${widths[size]}`
      }
    >
      {open && (
        <div
          className={
            side
              ? "safe-bottom animate-fade-up sm:animate-slide-in-right max-h-[92dvh] overflow-y-auto rounded-t-[2rem] border border-line bg-surface p-6 shadow-lift sm:h-full sm:max-h-none sm:rounded-[2rem] sm:pb-6"
              : "safe-bottom animate-fade-up max-h-[92dvh] overflow-y-auto rounded-t-[2rem] border border-line bg-surface p-6 shadow-lift sm:rounded-[2rem] sm:pb-6"
          }
        >
          <div className="mx-auto -mt-2 mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
          {(title || !hideClose) && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {title && (
                  <h2 id={titleId} className="text-xl font-semibold tracking-tight">
                    {title}
                  </h2>
                )}
                {description && (
                  <div id={descriptionId} className="mt-1 text-[15px] text-muted">
                    {description}
                  </div>
                )}
              </div>
              {!hideClose && (
                <IconButton label="Close" className="-mt-1 -mr-2" onClick={onClose}>
                  <X className="size-5" />
                </IconButton>
              )}
            </div>
          )}
          {children && <div className={title ? "mt-5" : ""}>{children}</div>}
        </div>
      )}
    </dialog>
  );
}
