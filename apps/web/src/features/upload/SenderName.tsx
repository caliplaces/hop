import { BadgeCheck, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";

/**
 * "Sending as SmokyMonkey441 ✎". A one-line affordance instead of a form:
 * most people never change it, and those who do tap once.
 */
export function SenderName({
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
      <p className="flex items-center gap-1.5 text-sm text-muted">
        Sending as <span className="font-semibold text-fg">{verifiedAs}</span>
        <BadgeCheck className="size-4 text-fg" aria-label="Signed in" />
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
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted transition hover:bg-surface-2"
        onClick={() => setEditing(true)}
      >
        Sending as <span className="font-semibold text-fg">{name || "Anonymous"}</span>
        <Pencil className="size-3.5" aria-label="Change name" />
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
