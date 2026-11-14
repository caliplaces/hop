import type { Me } from "@hop/shared";
import { ExternalLink, LogOut } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Button, buttonClass } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { signOut } from "../../lib/api";
import { hopUrl } from "../../lib/format";

export type AthleteMe = Me & { handle: string };

export function AccountDialog({
  me,
  open,
  onClose,
}: {
  me: AthleteMe;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} size="sm">
      <div className="flex items-center gap-3">
        <Avatar name={me.name ?? me.handle} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{me.name ?? `@${me.handle}`}</p>
          <p className="truncate text-sm text-muted">@{me.handle}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <a
          className={buttonClass({ variant: "soft", className: "justify-start" })}
          href={hopUrl(me.handle)}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="size-4" /> Open my upload page
        </a>
        <Button variant="soft" className="justify-start" onClick={() => signOut()}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </Dialog>
  );
}
