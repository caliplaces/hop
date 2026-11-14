import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { CircleAlert } from "lucide-react";
import type { RefObject } from "react";

/** Cloudflare Turnstile. Invisible for most people; shows a checkbox only when needed. */
export function HumanCheck({
  siteKey,
  widgetRef,
  error,
  onToken,
  onError,
  onRetry,
}: {
  siteKey: string | undefined;
  widgetRef: RefObject<TurnstileInstance | null>;
  error: string | null;
  onToken: (token: string) => void;
  onError: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      {siteKey && (
        <div className="flex justify-center empty:hidden">
          <Turnstile
            ref={widgetRef}
            siteKey={siteKey}
            options={{ size: "flexible", appearance: "interaction-only", action: "upload" }}
            onSuccess={onToken}
            onError={onError}
            onExpire={onRetry}
          />
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <CircleAlert className="size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" className="font-semibold underline" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </>
  );
}
