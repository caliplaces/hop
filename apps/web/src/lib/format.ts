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

export function hopUrl(handle: string, slug?: string): string {
  const base = `${window.location.origin}/${handle}`;
  return slug ? `${base}/${slug}` : base;
}

export function displayHopUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
