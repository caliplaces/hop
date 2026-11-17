import type { UploadItem } from "../../lib/uploader";

export type QueueSummary = {
  /** Files still in the list, cancelled ones aside. */
  total: number;
  sent: number;
  failed: number;
  /** Waiting, uploading or finishing. */
  active: number;
  /** All of them together, from 0 to 1: bytes sent over bytes to send. */
  fraction: number;
};

/** Where a batch of uploads stands, as the list's header and the floating bar say it. */
export function queueSummary(items: UploadItem[]): QueueSummary {
  let total = 0;
  let sent = 0;
  let failed = 0;
  let active = 0;
  let bytesDone = 0;
  let bytesTotal = 0;
  for (const item of items) {
    if (item.status === "cancelled") continue;
    total++;
    bytesTotal += item.file.size;
    if (item.status === "done") {
      sent++;
      bytesDone += item.file.size;
    } else {
      bytesDone += Math.min(item.uploadedBytes, item.file.size);
      if (item.status === "error") failed++;
      else active++;
    }
  }
  return { total, sent, failed, active, fraction: bytesTotal ? bytesDone / bytesTotal : 0 };
}

const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** "Sending 2 of 5", "3 files sent", "2 sent, 1 didn't go", in words. */
export function summaryText({ total, sent, failed, active }: QueueSummary): string {
  // Which file it's on: the next after those that went, or didn't.
  if (active > 0) return `Sending ${Math.min(sent + failed + 1, total)} of ${total}`;
  if (failed > 0) {
    return sent > 0 ? `${sent} sent, ${failed} didn’t go` : `${files(failed)} didn’t go`;
  }
  return `${files(sent)} sent`;
}
