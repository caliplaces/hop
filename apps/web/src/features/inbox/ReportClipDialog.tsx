import { type InboxFile, REPORT_REASONS, type ReportReason } from "@hop/shared";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useFeedback } from "../../components/ui/feedback";
import { ApiError } from "../../lib/api";
import { useModeration } from "./useModeration";

const REASON_LABELS: Record<ReportReason, string> = {
  sexual: "Sexual content",
  violence: "Violence or threats",
  harassment: "Harassment or hate",
  spam: "Spam or scam",
  other: "Something else",
};

const MAX_NOTE = 500;

const message = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/** Why a block didn't happen, in a sentence: shared with the viewer's own Block. */
export function blockProblem(error: unknown): string {
  // Clips from before senders were remembered carry no way to recognise them.
  if (error instanceof ApiError && error.code === "cant_block") {
    return "This clip’s sender can’t be blocked.";
  }
  return message(error, "Blocking didn’t work. Check your connection and try again.");
}

/**
 * Reporting a clip, as the app's sheet (ReportClipSheet.swift): why, an
 * optional word for Hop's team, and blocking whoever sent it too. Reported
 * either way; blocking is the extra, and says so if it couldn't be done.
 * `onBlocked` gets the clips that left the inbox with the block.
 */
export function ReportClipDialog({
  file,
  onClose,
  onBlocked,
}: {
  file: InboxFile | null;
  onClose: () => void;
  onBlocked: (removedIds: string[]) => void;
}) {
  const { report, block } = useModeration();
  const { toast } = useFeedback();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const sender = file?.contributorName ?? "this sender";
  const busy = report.isPending || block.isPending;

  const close = () => {
    setReason(null);
    setNote("");
    setAlsoBlock(false);
    report.reset();
    onClose();
  };

  const send = async () => {
    if (!file || !reason || busy) return;
    try {
      await report.mutateAsync({ file, reason, note });
    } catch {
      return; // shown in the dialog
    }
    if (!alsoBlock) {
      toast("Reported. Hop’s team will look into it.");
      close();
      return;
    }
    try {
      const { removedIds } = await block.mutateAsync(file);
      toast(`Reported, and ${sender} is blocked.`);
      close();
      onBlocked(removedIds);
    } catch (error) {
      toast(`Reported. ${blockProblem(error)}`, "error");
      close();
    }
  };

  return (
    <Dialog
      open={file !== null}
      onClose={busy ? () => {} : close}
      size="sm"
      title="Report clip"
      description="Hop’s team gets your report with this clip, and looks into it."
    >
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-muted">What’s wrong with it?</legend>
          <div className="flex flex-col gap-1">
            {REPORT_REASONS.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2"
              >
                <input
                  type="radio"
                  name="clip-report-reason"
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

        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(event) => setAlsoBlock(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-current"
          />
          <span className="text-sm">
            <span className="font-semibold">Block {sender} too</span>
            <span className="mt-0.5 block text-muted">
              Their clips leave your inbox, and they can’t send you more.
            </span>
          </span>
        </label>

        {report.isError && (
          <p
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            <CircleAlert className="size-4 shrink-0" />
            {message(
              report.error,
              "Couldn’t send your report. Check your connection and try again.",
            )}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="soft" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="dark" disabled={!reason || busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
