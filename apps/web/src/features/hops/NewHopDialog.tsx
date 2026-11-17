import { isOffensive, slugify } from "@hop/shared";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { FieldHint, Input } from "../../components/ui/Input";
import { ApiError } from "../../lib/api";
import { displayHopUrl, hopUrl } from "../../lib/format";
import { useHopMutations } from "./useHopMutations";

export function NewHopDialog({
  handle,
  open,
  onClose,
}: {
  handle: string;
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const { create } = useHopMutations();
  const slug = slugify(title);
  // As the API checks it: the name and its link are both public.
  const unavailable = Boolean(slug) && (isOffensive(title) || isOffensive(slug));
  const close = () => {
    setTitle("");
    create.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New event"
      description="Each event keeps its clips apart, with a link of its own. To have your main link send clips there too, choose “Send my link here”. Close it when the event’s over."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate(title.trim(), { onSuccess: close });
        }}
      >
        <Input
          aria-label="Event name"
          placeholder="e.g. Worlds 2026"
          value={title}
          maxLength={80}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        {unavailable ? (
          <FieldHint tone="danger">That name isn’t available. Pick another.</FieldHint>
        ) : create.error ? (
          <FieldHint tone="danger">
            {create.error instanceof ApiError ? create.error.message : "Couldn't create the event."}
          </FieldHint>
        ) : (
          <FieldHint>{slug ? displayHopUrl(hopUrl(handle, slug)) : " "}</FieldHint>
        )}
        <Button
          type="submit"
          size="lg"
          className="mt-4 w-full"
          disabled={!slug || unavailable || create.isPending}
        >
          {create.isPending ? "Creating…" : "Create event"}
        </Button>
      </form>
    </Dialog>
  );
}
