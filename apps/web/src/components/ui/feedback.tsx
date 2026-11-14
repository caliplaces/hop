import { CircleAlert, CircleCheck } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
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

/** In-app confirmations and toasts, replacing window.confirm/alert. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

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
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-8"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-fade-up flex items-center gap-2 rounded-full bg-fg py-2.5 pr-5 pl-3 text-sm font-medium text-canvas shadow-lift"
          >
            {t.tone === "success" ? (
              <CircleCheck className="size-5 text-hop" />
            ) : (
              <CircleAlert className="size-5 text-danger" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback must be used inside FeedbackProvider");
  return value;
}
