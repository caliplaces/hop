import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFeedback } from "../../components/ui/feedback";
import { ApiError, api } from "../../lib/api";

/** Create, open/close and "make live" for hops; each refreshes hops and the session. */
export function useHopMutations() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["hops"] });
    queryClient.invalidateQueries({ queryKey: ["me"] });
  };
  const onError = (e: unknown) =>
    toast(e instanceof ApiError ? e.message : "Something went wrong.", "error");

  const create = useMutation({
    mutationFn: (title: string) => api("/me/hops", { method: "POST", json: { title } }),
    onSuccess: () => {
      refresh();
      toast("Hop created");
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "closed" }) =>
      api(`/me/hops/${id}`, { method: "PATCH", json: { status } }),
    onSuccess: (_, { status }) => {
      refresh();
      toast(status === "closed" ? "Hop closed" : "Hop reopened");
    },
    onError,
  });
  const makeLive = useMutation({
    mutationFn: (id: string) => api(`/me/hops/${id}/activate`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast("Your link now uploads here");
    },
    onError,
  });

  return { create, setStatus, makeLive };
}
