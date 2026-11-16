import type { PlanStatus } from "@hop/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useFeedback } from "../../components/ui/feedback";
import { api } from "../../lib/api";
import { queries } from "../../lib/queries";

/**
 * Back from Stripe Checkout: reads the plan from Stripe now, rather than
 * waiting for its webhook, and says how it went. `done` runs after, to take
 * the marker off the URL.
 */
export function useWelcomeBack(returning: boolean, done: () => void) {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const started = useRef(false);
  const finish = useRef(done);
  finish.current = done;

  useEffect(() => {
    if (!returning || started.current) return;
    started.current = true;
    api<PlanStatus>("/billing/web/sync", { method: "POST" })
      .then((status) => {
        queryClient.setQueryData(queries.plan().queryKey, status);
        // The profile's Hop+ mark.
        void queryClient.invalidateQueries({ queryKey: queries.me().queryKey });
        toast(
          status.plan === "plus"
            ? "Welcome to Hop+"
            : "Hop+ starts as soon as your payment goes through",
        );
      })
      .catch(() => toast("Hop+ starts as soon as your payment goes through"))
      .finally(() => finish.current());
  }, [returning, queryClient, toast]);
}
