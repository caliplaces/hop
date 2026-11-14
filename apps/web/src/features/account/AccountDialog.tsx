import type { ColorId, Me } from "@hop/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LogOut } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Button, buttonClass } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useFeedback } from "../../components/ui/feedback";
import { api, signOut } from "../../lib/api";
import { hopUrl } from "../../lib/format";
import { queries } from "../../lib/queries";
import { ColorPicker } from "./ColorPicker";

export type AthleteMe = Me & { handle: string };

function useSetColor(me: AthleteMe) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const key = queries.me().queryKey;
  return useMutation({
    mutationFn: (color: ColorId) => api<{ me: Me }>("/me", { method: "PATCH", json: { color } }),
    // Optimistic: the whole app recolours instantly, and rolls back on failure.
    onMutate: (color: ColorId) => {
      const previous = queryClient.getQueryData<Me | null>(key);
      const next: Me = { ...me, color };
      queryClient.setQueryData<Me | null>(key, next);
      return { previous };
    },
    onError: (_error, _color, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast("Couldn’t save your colour.", "error");
    },
    onSuccess: ({ me: updated }) => queryClient.setQueryData(key, updated),
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
