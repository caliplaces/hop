import type { ColorId, Me } from "@hop/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LogOut, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { Button, buttonClass } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useFeedback } from "../../components/ui/feedback";
import { Switch } from "../../components/ui/Switch";
import { api, signOut } from "../../lib/api";
import { hopUrl } from "../../lib/format";
import { queries } from "../../lib/queries";
import { ColorPicker } from "./ColorPicker";
import { DeleteAccount } from "./DeleteAccount";

export type AthleteMe = Me & { handle: string };

function useSetColor(me: AthleteMe) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const key = queries.me().queryKey;
  const latest = useRef<ColorId | null>(null);
  return useMutation({
    // Saves run one after another (same scope), so the server ends on the last pick.
    scope: { id: "profile-colour" },
    mutationFn: (color: ColorId) => api<{ me: Me }>("/me", { method: "PATCH", json: { color } }),
    // Optimistic: the whole app recolours instantly.
    onMutate: (color: ColorId) => {
      latest.current = color;
      const next: Me = { ...me, color };
      queryClient.setQueryData<Me | null>(key, next);
    },
    // Only the response for the most recent pick may touch the cache; older
    // ones would flash an earlier colour back. Merge just the colour: the rest
    // of the response may predate another setting saved meanwhile.
    onSuccess: ({ me: updated }, color) => {
      if (latest.current !== color) return;
      queryClient.setQueryData(key, (current) =>
        current ? { ...current, color: updated.color } : updated,
      );
    },
    onError: (_error, color) => {
      if (latest.current !== color) return; // a later pick is still on its way
      toast("Couldn’t save your colour.", "error");
      queryClient.invalidateQueries({ queryKey: key }); // fall back to what the server has
    },
  });
}

function useSetEmailNewClips() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const key = queries.me().queryKey;
  return useMutation({
    scope: { id: "profile-email" },
    mutationFn: (emailNewClips: boolean) =>
      api<{ me: Me }>("/me", { method: "PATCH", json: { emailNewClips } }),
    onMutate: (emailNewClips: boolean) => {
      queryClient.setQueryData(key, (current) =>
        current ? { ...current, emailNewClips } : current,
      );
    },
    // Merge just this setting, for the same reason as the colour above.
    onSuccess: ({ me: updated }) =>
      queryClient.setQueryData(key, (current) =>
        current ? { ...current, emailNewClips: updated.emailNewClips } : updated,
      ),
    onError: () => {
      toast("Couldn’t save your email settings.", "error");
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function AccountDialog({
  me,
  open,
  onClose,
}: {
  me: AthleteMe;
  open: boolean;
  onClose: () => void;
}) {
  const setColor = useSetColor(me);
  const setEmailNewClips = useSetEmailNewClips();
  const [deleting, setDeleting] = useState(false);
  const close = () => {
    setDeleting(false);
    onClose();
  };

  if (deleting) {
    return (
      <Dialog open={open} onClose={close} size="sm" hideClose>
        <DeleteAccount handle={me.handle} onCancel={() => setDeleting(false)} />
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={close} size="sm">
      <div className="flex items-center gap-3">
        <Avatar name={me.name ?? me.handle} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{me.name ?? `@${me.handle}`}</p>
          <p className="truncate text-sm text-muted">@{me.handle}</p>
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-sm font-medium text-muted">Your page colour</p>
        <ColorPicker value={me.color} onChange={(color) => setColor.mutate(color)} />
      </div>

      <div className="mt-6">
        <p className="mb-3 text-sm font-medium text-muted">Email</p>
        <Switch
          label="New clips"
          description={
            me.email
              ? `One email to ${me.email} when a burst of clips arrives.`
              : "When a burst of clips arrives."
          }
          checked={me.emailNewClips}
          onChange={(checked) => setEmailNewClips.mutate(checked)}
        />
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

      <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-4 text-sm">
        <a className="text-muted underline-offset-4 hover:underline" href="/privacy">
          Privacy
        </a>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-medium text-danger underline-offset-4 hover:underline"
          onClick={() => setDeleting(true)}
        >
          <Trash2 className="size-4" /> Delete account
        </button>
      </div>
    </Dialog>
  );
}
