export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(ms);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 60 * 60],
  ["day", 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["year", 365 * 24 * 60 * 60],
];

/** How long ago, as people say it: "now", "5 minutes ago", "yesterday", as the app's viewer. */
export function relativeTime(ms: number, now = Date.now(), locale?: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((ms - now) / 1000);
  const elapsed = Math.abs(seconds);
  if (elapsed < 45) return format.format(0, "second");
  let [unit, size] = RELATIVE_UNITS[0] as [Intl.RelativeTimeFormatUnit, number];
  for (const [next, nextSize] of RELATIVE_UNITS)
    if (elapsed >= nextSize) [unit, size] = [next, nextSize];
  return format.format(Math.round(seconds / size) || Math.sign(seconds), unit);
}

export function hopUrl(handle: string, slug?: string): string {
  const base = `${window.location.origin}/${handle}`;
  return slug ? `${base}/${slug}` : base;
}

export function displayHopUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
