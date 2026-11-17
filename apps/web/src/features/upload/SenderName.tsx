import { UPLOAD_NOTE_MAX } from "@hop/shared";
import { BadgeCheck, MessageSquareText, Pencil, UserRound } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * "Sending as SmokyMonkey441 ✎". A one-line affordance instead of a form:
 * most people never change it, and those who do tap once.
 */
function SenderName({
  verifiedAs,
  name,
  onChange,
  signInHref,
}: {
  verifiedAs: string | null;
  name: string;
  onChange: (name: string) => void;
  signInHref: string;
}) {
  const [editing, setEditing] = useState(false);

  if (verifiedAs) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        Sending as <span className="truncate font-semibold text-fg">{verifiedAs}</span>
        <BadgeCheck className="size-4 shrink-0 text-fg" aria-label="Signed in" />
      </p>
    );
  }

  if (editing) {
    const finish = () => name.trim() && setEditing(false);
    return (
      <form
        className="flex w-full items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          finish();
        }}
      >
        <Input
          aria-label="Your name"
          className="h-11"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          onBlur={finish}
        />
        <Button type="submit" variant="soft" disabled={!name.trim()}>
          Done
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        className="-ml-2 flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-sm text-muted transition hover:bg-surface-2"
        onClick={() => setEditing(true)}
      >
        Sending as <span className="truncate font-semibold text-fg">{name || "Anonymous"}</span>
        <Pencil className="size-3.5 shrink-0" aria-label="Change name" />
      </button>
      <a
        href={signInHref}
        className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
      >
        or sign in with Caliplaces to use your profile
      </a>
    </div>
  );
}

/** An optional line for the athlete, which goes with the clips sent after it's written. */
function NoteField({
  note,
  onChange,
  recipient,
  started,
}: {
  note: string;
  onChange: (note: string) => void;
  recipient: string;
  started: boolean;
}) {
  const [open, setOpen] = useState(note.length > 0);
  const id = useId();

  if (!open) {
    return (
      <button
        type="button"
        className="-ml-2 rounded-full px-2 py-1 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
        onClick={() => setOpen(true)}
      >
        Add a note for {recipient}
      </button>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-muted">
        Note for {recipient} <span className="text-subtle">(optional)</span>
      </label>
      <textarea
        id={id}
        value={note}
        onChange={(e) => onChange(e.target.value.slice(0, UPLOAD_NOTE_MAX))}
        maxLength={UPLOAD_NOTE_MAX}
        rows={2}
        // biome-ignore lint/a11y/noAutofocus: it opens when they asked to write one
        autoFocus={note.length === 0}
        placeholder="e.g. Round 2, from the left side"
        className="mt-1.5 w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none transition placeholder:text-subtle focus:border-fg focus:ring-4 focus:ring-accent-soft"
      />
      <p className="mt-1 flex justify-between gap-3 text-xs text-muted">
        <span>
          {started ? "Goes with the clips you add next." : "Goes with the clips you send."}
        </span>
        <span className="tabular-nums">
          {note.length}/{UPLOAD_NOTE_MAX}
        </span>
      </p>
    </div>
  );
}

/** Who's sending, and an optional note: one glass card under the picker. */
export function SenderCard({
  verifiedAs,
  name,
  onNameChange,
  signInHref,
  note,
  onNoteChange,
  recipient,
  started,
}: {
  verifiedAs: string | null;
  name: string;
  onNameChange: (name: string) => void;
  signInHref: string;
  note: string;
  onNoteChange: (note: string) => void;
  recipient: string;
  started: boolean;
}) {
  return (
    <section aria-label="From you" className="glass rounded-(--radius-card) px-4 py-1 sm:px-5">
      <Row icon={<UserRound className="size-4" />}>
        <SenderName
          verifiedAs={verifiedAs}
          name={name}
          onChange={onNameChange}
          signInHref={signInHref}
        />
      </Row>
      <div className="border-t border-line" />
      <Row icon={<MessageSquareText className="size-4" />}>
        <NoteField note={note} onChange={onNoteChange} recipient={recipient} started={started} />
      </Row>
    </section>
  );
}
