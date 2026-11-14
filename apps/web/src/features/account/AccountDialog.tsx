import type { ColorId, Me } from "@hop/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LogOut } from "lucide-react";
import { useRef } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { Button, buttonClass } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useFeedback } from "../../components/ui/feedback";
import { Switch } from "../../components/ui/Switch";
import { api, signOut } from "../../lib/api";
import { hopUrl } from "../../lib/format";
import { queries } from "../../lib/queries";
import { ColorPicker } from "./ColorPicker";

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
    // ones would flash an earlier colour back.
    onSuccess: ({ me: updated }, color) => {
      if (latest.current === color) queryClient.setQueryData(key, updated);
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
    onSuccess: ({ me }) => queryClient.setQueryData(key, me),
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

  return (
    <Dialog open={open} onClose={onClose} size="sm">
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
    </Dialog>
  );
}
