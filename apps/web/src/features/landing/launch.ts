import { useEffect, useState } from "react";

/** Hop opens to everyone at midnight Central European Time on 1 December 2026. */
export const LAUNCH_AT = Date.parse("2026-12-01T00:00:00+01:00");
export const LAUNCH_DAY = "December 1";

export type TimeLeft = { days: number; hours: number; minutes: number; seconds: number };

/** Whole days, hours, minutes and seconds until `target`, or null once it has passed. */
export function timeLeft(now: number, target = LAUNCH_AT): TimeLeft | null {
  const total = Math.floor((target - now) / 1000);
  if (total <= 0) return null;
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor(total / 3_600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
  };
}

/** setTimeout fires immediately for delays past 2^31 - 1 ms (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Flips to true at launch, also for a page that was opened before it. */
export function useLaunched(): boolean {
  const [launched, setLaunched] = useState(() => Date.now() >= LAUNCH_AT);
  useEffect(() => {
    if (launched) return;
    const delay = LAUNCH_AT - Date.now();
    if (delay > MAX_TIMEOUT_MS) return;
    const id = setTimeout(() => setLaunched(true), Math.max(0, delay));
    return () => clearTimeout(id);
  }, [launched]);
  return launched;
}

/** The current time, ticking every `ms` while the tab is visible. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(id);
      id = undefined;
    };
    const start = () => {
      stop();
      setNow(Date.now());
      id = setInterval(() => setNow(Date.now()), ms);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
  return now;
}
