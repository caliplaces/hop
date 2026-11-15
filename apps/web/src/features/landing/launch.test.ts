import { describe, expect, it } from "vitest";
import { LAUNCH_AT, launchCheckDelay, timeLeft } from "./launch";

describe("timeLeft", () => {
  it("launches at midnight CET on 1 December 2026", () => {
    expect(new Date(LAUNCH_AT).toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });

  it("splits the remaining time into days, hours, minutes and seconds", () => {
    const now = LAUNCH_AT - ((2 * 24 + 3) * 3_600 + 4 * 60 + 5) * 1000;
    expect(timeLeft(now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
  });

  it("rounds a partial second down", () => {
    expect(timeLeft(LAUNCH_AT - 1_999)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1 });
  });

  it("is null from the launch moment on", () => {
    expect(timeLeft(LAUNCH_AT - 999)).toBeNull();
    expect(timeLeft(LAUNCH_AT)).toBeNull();
    expect(timeLeft(LAUNCH_AT + 60_000)).toBeNull();
  });
});

describe("launchCheckDelay", () => {
  const HOUR = 60 * 60 * 1000;

  it("waits until launch when it's close", () => {
    expect(launchCheckDelay(LAUNCH_AT - 5_000)).toBe(5_000);
  });

  it("checks again within the hour when launch is far off", () => {
    expect(launchCheckDelay(LAUNCH_AT - 40 * 24 * HOUR)).toBe(HOUR);
  });

  it("is null from the launch moment on", () => {
    expect(launchCheckDelay(LAUNCH_AT)).toBeNull();
    expect(launchCheckDelay(LAUNCH_AT + 1)).toBeNull();
  });
});
