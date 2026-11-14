import { useEffect, useRef } from "react";

/**
 * Drives a native <dialog> from React state with showModal(), which gives focus
 * trapping, Esc handling and an inert background for free. Focus returns to
 * the element that opened it.
 */
export function useModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}
