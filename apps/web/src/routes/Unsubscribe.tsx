import { useMutation } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button } from "../components/ui/Button";
import { StatusScreen } from "../features/upload/StatusScreen";
import { ApiError, api } from "../lib/api";

const route = getRouteApi("/unsubscribe");

/**
 * Where an email's "Unsubscribe" link lands. It asks first: link scanners in
 * some inboxes open every link, and that mustn't switch emails off.
 */
export function Unsubscribe() {
  const { token } = route.useSearch();
  const update = useMutation({
    mutationFn: (subscribe: boolean) =>
      api<{ subscribed: boolean }>("/email/unsubscribe", {
        method: "POST",
        json: { token, subscribe },
      }),
  });

  const expired = update.error instanceof ApiError && update.error.code === "invalid_token";
  if (!token || expired) {
    return (
      <StatusScreen mascot="broken" title="This link has expired">
        You can turn new-clip emails on or off any time from your account settings.
      </StatusScreen>
    );
  }

  // A dropped connection or a server hiccup: the link is fine, so offer a retry.
  if (update.isError) {
    return (
      <StatusScreen
        mascot="broken"
        title="That didn’t go through"
        action={
          <Button
            onClick={() => update.mutate(update.variables ?? false)}
            disabled={update.isPending}
          >
            Try again
          </Button>
        }
      >
        We couldn’t update your email settings. Check your connection and try again.
      </StatusScreen>
    );
  }

  if (update.data && !update.data.subscribed) {
    return (
      <StatusScreen
        mascot="sleep"
        title="You’re unsubscribed"
        action={
          <Button variant="soft" onClick={() => update.mutate(true)} disabled={update.isPending}>
            Undo
          </Button>
        }
      >
        No more emails about new clips. Your inbox still collects every clip.
      </StatusScreen>
    );
  }

  if (update.data?.subscribed) {
    return (
      <StatusScreen mascot="cheer" title="You’re subscribed again">
        We’ll email you when new clips arrive.
      </StatusScreen>
    );
  }

  return (
    <StatusScreen
      mascot="idle"
      title="Stop new-clip emails?"
      action={
        <Button onClick={() => update.mutate(false)} disabled={update.isPending}>
          {update.isPending ? "Unsubscribing…" : "Unsubscribe"}
        </Button>
      }
    >
      You’ll stop getting an email when clips arrive on your Hop. Your inbox still collects every
      clip.
    </StatusScreen>
  );
}
