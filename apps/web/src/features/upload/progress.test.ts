import { describe, expect, it } from "vitest";
import type { UploadItem, UploadStatus } from "../../lib/uploader";
import { queueSummary, summaryText } from "./progress";

let next = 0;
const item = (status: UploadStatus, size: number, uploadedBytes = 0): UploadItem => ({
  id: `u${++next}`,
  file: new File([new Uint8Array(size)], `clip${next}.mp4`, { type: "video/mp4" }),
  status,
  uploadedBytes,
});

describe("a batch of uploads", () => {
  it("counts bytes across every file, leaving cancelled ones out", () => {
    const summary = queueSummary([
      item("done", 100, 100),
      item("uploading", 100, 50),
      item("queued", 200),
      item("cancelled", 1000, 500),
    ]);
    expect(summary).toEqual({ total: 3, sent: 1, failed: 0, active: 2, fraction: 150 / 400 });
  });

  it("counts a failed file's bytes as far as they got", () => {
    const summary = queueSummary([item("error", 100, 40), item("done", 100, 100)]);
    expect(summary).toMatchObject({ failed: 1, sent: 1, active: 0, fraction: 0.7 });
  });

  it("never counts more than a file's size", () => {
    expect(queueSummary([item("finishing", 100, 130)]).fraction).toBe(1);
  });

  it("is nothing with nothing to send", () => {
    expect(queueSummary([item("cancelled", 10)])).toEqual({
      total: 0,
      sent: 0,
      failed: 0,
      active: 0,
      fraction: 0,
    });
  });

  it("says where it stands", () => {
    expect(summaryText({ total: 5, sent: 1, failed: 0, active: 4, fraction: 0.2 })).toBe(
      "Sending 2 of 5",
    );
    expect(summaryText({ total: 3, sent: 3, failed: 0, active: 0, fraction: 1 })).toBe(
      "3 files sent",
    );
    expect(summaryText({ total: 1, sent: 1, failed: 0, active: 0, fraction: 1 })).toBe(
      "1 file sent",
    );
    expect(summaryText({ total: 3, sent: 2, failed: 1, active: 0, fraction: 0.9 })).toBe(
      "2 sent, 1 didn’t go",
    );
    expect(summaryText({ total: 2, sent: 0, failed: 2, active: 0, fraction: 0 })).toBe(
      "2 files didn’t go",
    );
    // Failures while others are still going: still sending, on the last one.
    expect(summaryText({ total: 3, sent: 1, failed: 1, active: 1, fraction: 0.5 })).toBe(
      "Sending 3 of 3",
    );
  });
});
