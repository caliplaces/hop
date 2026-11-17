import type { InboxFile, ReportReason } from "@hop/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** What blocking answers: which of the athlete's clips went with it. */
type BlockResult = { ok: true; removed: number; removedIds: string[] };

/**
 * Reporting a clip to Hop's team, and blocking whoever sent it, as the app
 * does (Moderation.swift). A report holds the clip for the team; a block
 * takes every clip from that sender out of the inbox at once.
 */
export function useModeration() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["files"] });
    queryClient.invalidateQueries({ queryKey: ["hops"] });
    queryClient.invalidateQueries({ queryKey: ["cover"] });
    queryClient.invalidateQueries({ queryKey: ["plan"] });
  };

  const report = useMutation({
    mutationFn: ({ file, reason, note }: { file: InboxFile; reason: ReportReason; note: string }) =>
      api<{ ok: true }>(`/me/files/${encodeURIComponent(file.id)}/report`, {
        method: "POST",
        json: { reason, note: note.trim() || undefined },
      }),
  });

  const block = useMutation({
    mutationFn: (file: InboxFile) =>
      api<BlockResult>(`/me/files/${encodeURIComponent(file.id)}/block`, {
        method: "POST",
        json: {},
      }),
    onSuccess: refresh,
  });

  return { report, block };
}
