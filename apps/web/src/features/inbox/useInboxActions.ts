import type { InboxFile } from "@hop/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFeedback } from "../../components/ui/feedback";
import { api } from "../../lib/api";
import { canStreamZip, listAllFiles, zipToDisk } from "../../lib/download";

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Delete (with confirmation) and download, shared by the grid, selection and viewer. */
export function useInboxActions(handle: string) {
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const [sheetFiles, setSheetFiles] = useState<InboxFile[] | null>(null);
  const [downloading, setDownloading] = useState(false);

  const removeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api(`/me/files/${id}`, { method: "DELETE" });
    },
    onSuccess: (_, ids) => toast(ids.length === 1 ? "Deleted" : `Deleted ${ids.length} files`),
    onError: () => toast("Some files couldn't be deleted. Try again.", "error"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["hops"] });
    },
  });

  const remove = async (ids: string[]) => {
    const ok = await confirm({
      title: ids.length === 1 ? "Delete this file?" : `Delete ${ids.length} files?`,
      description:
        ids.length === 1
          ? "It’s removed for good. This can’t be undone."
          : "They’re removed for good. This can’t be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (ok) await removeMutation.mutateAsync(ids).catch(() => {});
    return ok;
  };

  /**
   * `load` may fetch more pages, so where a zip streams to disk the save dialog
   * opens first, while the click still counts as a user gesture.
   */
  const download = async (
    load: () => Promise<InboxFile[]>,
    count: number,
    mightHaveMore: boolean,
  ) => {
    setDownloading(true);
    try {
      if (canStreamZip() && (count > 1 || mightHaveMore)) {
        await zipToDisk(load, `${handle}-hop.zip`);
        toast("Download complete");
      } else {
        setSheetFiles(await load());
      }
    } catch (e) {
      if (!isAbort(e)) toast("Download failed. Please try again.", "error");
    } finally {
      setDownloading(false);
    }
  };

  return {
    remove,
    removing: removeMutation.isPending,
    download,
    downloading,
    sheetFiles,
    closeSheet: () => setSheetFiles(null),
    loadAll: listAllFiles,
  };
}
