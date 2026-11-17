import { describe, expect, it } from "vitest";
import { relativeTime } from "./format";

const NOW = Date.UTC(2026, 10, 17, 12);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("how long ago", () => {
  it("reads as people say it", () => {
    expect(relativeTime(NOW - 10 * 1000, NOW, "en")).toBe("now");
    expect(relativeTime(NOW - 50 * 1000, NOW, "en")).toBe("1 minute ago");
    expect(relativeTime(NOW - 5 * MINUTE, NOW, "en")).toBe("5 minutes ago");
    expect(relativeTime(NOW - 3 * HOUR, NOW, "en")).toBe("3 hours ago");
    expect(relativeTime(NOW - DAY, NOW, "en")).toBe("yesterday");
    expect(relativeTime(NOW - 3 * DAY, NOW, "en")).toBe("3 days ago");
    expect(relativeTime(NOW - 8 * DAY, NOW, "en")).toBe("last week");
    expect(relativeTime(NOW - 400 * DAY, NOW, "en")).toBe("last year");
  });

  it("never says now for something a minute or more off", () => {
    // 59 seconds rounds to 1 minute, not to 0.
    expect(relativeTime(NOW - 59 * 1000, NOW, "en")).toBe("1 minute ago");
  });
});
