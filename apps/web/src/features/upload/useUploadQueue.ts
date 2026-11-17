import { useEffect, useMemo, useState } from "react";
import { Uploader, type UploadItem } from "../../lib/uploader";

const ACTIVE = new Set(["queued", "uploading", "finishing"]);

/** One Uploader per hop, its live queue, and a guard against closing the tab mid-upload. */
export function useUploadQueue(
  hopId: string | undefined,
  getPass: () => Promise<string>,
  getName: () => string | undefined,
  getNote: () => string | undefined,
) {
  const uploader = useMemo(
    () => (hopId ? new Uploader(hopId, getPass, getName, getNote) : null),
    [hopId, getPass, getName, getNote],
  );
  const [items, setItems] = useState<UploadItem[]>([]);
  useEffect(() => uploader?.subscribe(setItems), [uploader]);

  // Uploads that failed because the connection dropped pick up again on their own.
  useEffect(() => {
    if (!uploader) return;
    const resume = () => uploader.retryFailed();
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [uploader]);

  const busy = items.some((i) => ACTIVE.has(i.status));
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const doneCount = items.filter((i) => i.status === "done").length;
  const allDone =
    items.length > 0 &&
    !busy &&
    items.every((i) => i.status === "done" || i.status === "cancelled");

  return { uploader, items, busy, doneCount, allDone };
}
