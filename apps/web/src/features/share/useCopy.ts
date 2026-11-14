import { useState } from "react";
import { useFeedback } from "../../components/ui/feedback";

export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const { toast } = useFeedback();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast("Link copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy. Long-press the link instead.", "error");
    }
  };
  return { copied, copy };
}
