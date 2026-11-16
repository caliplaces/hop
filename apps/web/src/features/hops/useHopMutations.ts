import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFeedback } from "../../components/ui/feedback";
import { ApiError, api } from "../../lib/api";

/** Create, close or reopen events, and point the link at one; each refreshes the events and the session. */
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
      toast("Event created");
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "closed" }) =>
      api(`/me/hops/${id}`, { method: "PATCH", json: { status } }),
    onSuccess: (_, { status }) => {
      refresh();
      toast(status === "closed" ? "Event closed" : "Event reopened");
    },
    onError,
  });
  const makeLive = useMutation({
    mutationFn: (id: string) => api(`/me/hops/${id}/activate`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast("Your link now sends clips here");
    },
    onError,
  });

  return { create, setStatus, makeLive };
}
