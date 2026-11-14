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

/**
 * Zip entry names grouped by contributor folder. Every final name is reserved,
 * so "clip.mp4", "clip.mp4" and "clip (1).mp4" can't collide (case-insensitive,
 * since macOS and Windows extract that way).
 */
export function zipEntryNames(files: { name: string; contributorName: string | null }[]): string[] {
  const used = new Set<string>();
  return files.map((f) => {
    const folder = safeSegment(f.contributorName ?? "", "Unknown");
    const name = safeSegment(f.name, "file");
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = `${folder}/${name}`;
    for (let n = 1; used.has(candidate.toLowerCase()); n++) {
      candidate = `${folder}/${stem} (${n})${ext}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
