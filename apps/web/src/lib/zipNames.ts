/** Make a string safe to use as one path segment inside a zip archive. */
export function safeSegment(input: string, fallback: string): string {
  const cleaned = input
    // biome-ignore lint/suspicious/noControlCharactersInRegex: replacing control characters is the point
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 120);
  // "." and ".." would escape the folder when extracted.
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned : fallback;
}

/** Zip entry names grouped by contributor folder, de-duplicated. */
export function zipEntryNames(files: { name: string; contributorName: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const folder = safeSegment(f.contributorName ?? "", "Unknown");
    const name = safeSegment(f.name, "file");
    const base = `${folder}/${name}`;
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    if (count === 0) return base;
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${folder}/${name.slice(0, dot)} (${count})${name.slice(dot)}`
      : `${base} (${count})`;
  });
}
