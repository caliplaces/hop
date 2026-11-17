import { CircleAlert, CircleCheck } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "default";
};
type Toast = { id: number; message: string; tone: "success" | "error" };

type Feedback = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, tone?: Toast["tone"]) => void;
};

const FeedbackContext = createContext<Feedback | null>(null);

/**
 * Where toasts show: inside the topmost open modal dialog, such as the clip
 * viewer, if there is one. A modal sits above everything outside it, and
 * makes it inert, whatever its z-index.
 */
export function toastHost(doc: Document = document): Element {
  const isModal = (dialog: HTMLDialogElement) => {
    try {
      return dialog.matches(":modal");
    } catch {
      return true; // Too old to know: an open dialog is most likely one.
    }
  };
  const modals = [...doc.querySelectorAll("dialog")].filter((d) => d.open && isModal(d));
  return modals.at(-1) ?? doc.body;
}

/**
 * Gives `update` where toasts show now, and again whenever a dialog opens,
 * closes, or comes or goes, until the returned function stops it. Dialogs
 * open and close in effects, after the render that showed the toast: Report
 * shows its toast and closes together, and the toast must then move to
 * what's below.
 */
export function followToastHost(
  update: (host: Element) => void,
  doc: Document = document,
  Observer: typeof MutationObserver = MutationObserver,
): () => void {
  const check = () => update(toastHost(doc));
  check();
  const observer = new Observer(check);
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  return () => observer.disconnect();
}

/** In-app confirmations and toasts, replacing window.confirm/alert. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const showing = toasts.length > 0;
  // Followed only while toasts show; null until the first look.
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    if (!showing) return;
    const stop = followToastHost(setHost);
    return () => {
      stop();
      setHost(null);
    };
  }, [showing]);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const toast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = nextId.current++;
    setToasts((all) => [...all, { id, message, tone }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => settle(false)}
        title={pending?.title}
        description={pending?.description}
        size="sm"
        hideClose
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="soft" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button
            variant={pending?.tone === "danger" ? "danger" : "dark"}
            onClick={() => settle(true)}
            autoFocus
          >
            {pending?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </Dialog>
      {createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+1.5rem)] z-(--z-toast) flex flex-col items-center gap-2 px-4 sm:bottom-8"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="animate-fade-up flex items-center gap-2 rounded-full bg-fg py-2.5 pr-5 pl-3 text-sm font-medium text-canvas shadow-lift"
            >
              {t.tone === "success" ? (
                <CircleCheck className="size-5 text-canvas" />
              ) : (
                <CircleAlert className="size-5 text-danger" />
              )}
              {t.message}
            </div>
          ))}
        </div>,
        // Over whichever modal is on top while they show (followToastHost).
        showing ? (host ?? toastHost()) : document.body,
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback must be used inside FeedbackProvider");
  return value;
}
