import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ApiError, api } from "../../lib/api";
import { displayHopUrl, hopUrl } from "../../lib/format";
import { queries } from "../../lib/queries";

/**
 * Deleting the account, as a step of the account dialog: what goes, what
 * stays, a word about Hop+ (cancelled with it if bought on the website; not
 * if bought from Apple), and the button. Once the server confirms, the
 * site starts over signed out (the API clears the cookie).
 */
export function DeleteAccount({ handle, onCancel }: { handle: string; onCancel: () => void }) {
  const plan = useQuery(queries.plan());
  // Hop+ from the website, which the API cancels in Stripe first.
  const web = plan.data?.subscription?.provider === "stripe";
  const remove = useMutation({
    mutationFn: () => api<{ ok: true }>("/me", { method: "DELETE", json: {} }),
    onSuccess: () => window.location.assign("/"),
    // Already gone (a retry after a lost reply): start over all the same.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) window.location.assign("/");
    },
  });
  const failed =
    remove.isError && !(remove.error instanceof ApiError && remove.error.status === 401);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Delete your Hop account?</h2>
      <p className="mt-1 text-sm text-muted">This can’t be undone.</p>

      <ul className="mt-5 list-disc space-y-2 pl-5 text-[15px] leading-relaxed marker:text-muted">
        <li>Every clip and event in your inbox is deleted.</li>
        <li>Your name and photo are removed.</li>
        <li>{displayHopUrl(hopUrl(handle))} stops working, and nobody else can take it.</li>
        <li>You’re signed out everywhere, in the app too.</li>
      </ul>

      {web ? (
        <p className="mt-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed">
          Your Hop+ subscription is cancelled at once, and the rest of this period isn’t refunded.
        </p>
      ) : (
        <p className="mt-5 rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed">
          If you have Hop+ from the iPhone app, deleting your account doesn’t cancel it. Apple keeps
          billing you until you cancel it in your Apple Account’s subscriptions.
        </p>
      )}
      <p className="mt-3 text-sm text-muted">
        Save any clips you want to keep first. Your Caliplaces account isn’t affected.
      </p>

      {failed && (
        <p
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          <CircleAlert className="size-4 shrink-0" />
          {remove.error instanceof ApiError
            ? remove.error.message
            : "Couldn’t delete your account. Check your connection and try again."}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? "Deleting…" : "Delete my account"}
        </Button>
        <Button variant="soft" onClick={onCancel} disabled={remove.isPending}>
          Keep my account
        </Button>
      </div>
    </div>
  );
}
