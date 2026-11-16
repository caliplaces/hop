import { REPORT_REASONS, type ReportReason } from "@hop/shared";
import { Turnstile } from "@marsidev/react-turnstile";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, Flag } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { ApiError, api } from "../../lib/api";

const REASON_LABELS: Record<ReportReason, string> = {
  sexual: "Sexual content",
  violence: "Violence or threats",
  harassment: "Harassment or hate",
  spam: "Spam or scam",
  other: "Something else",
};

const MAX_NOTE = 500;

/**
 * "Report this page", at the foot of an athlete's upload page: anyone can
 * tell Hop's team about a name or photo that shouldn't be there. Behind
 * Turnstile, like uploads (App Store Guideline 1.2).
 */
export function ReportPage({ handle, siteKey }: { handle: string; siteKey: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () =>
      api<{ ok: true }>(`/h/${encodeURIComponent(handle)}/report`, {
        method: "POST",
        json: { reason, note: note.trim() || undefined, turnstileToken: token },
      }),
    // A Turnstile token counts once: a retry needs a new one.
    onError: () => setToken(null),
  });

  const close = () => {
    setOpen(false);
    setReason(null);
    setNote("");
    setToken(null);
    send.reset();
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
        onClick={() => setOpen(true)}
      >
        <Flag className="size-3" /> Report this page
      </button>

      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title={send.isSuccess ? "Thanks for telling us" : "Report this page"}
        description={
          send.isSuccess
            ? "Hop’s team will look into it."
            : "Tell Hop’s team about a name or photo that shouldn’t be here."
        }
      >
        {send.isSuccess ? (
          <Button className="mt-6 w-full" onClick={close}>
            Done
          </Button>
        ) : (
          <form
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason && token) send.mutate();
            }}
          >
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-muted">What’s wrong?</legend>
              <div className="flex flex-col gap-1">
                {REPORT_REASONS.map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2"
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={option}
                      checked={reason === option}
                      onChange={() => setReason(option)}
                      className="size-4 accent-current"
                    />
                    {REASON_LABELS[option]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-muted">
                Anything else? (optional)
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE))}
                maxLength={MAX_NOTE}
                rows={3}
                className="w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[15px] outline-none focus:border-line-strong"
              />
            </label>

            {siteKey && !token && (
              <div className="mt-3 flex justify-center empty:hidden">
                <Turnstile
                  siteKey={siteKey}
                  options={{ size: "flexible", appearance: "interaction-only", action: "report" }}
                  onSuccess={setToken}
                />
              </div>
            )}

            {send.isError && (
              <p
                role="alert"
                className="mt-4 flex items-center gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                <CircleAlert className="size-4 shrink-0" />
                {send.error instanceof ApiError
                  ? send.error.message
                  : "Couldn’t send your report. Check your connection and try again."}
              </p>
            )}

            <Button
              type="submit"
              className="mt-5 w-full"
              disabled={!reason || !token || send.isPending}
            >
              {send.isPending ? "Sending…" : "Send report"}
            </Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
