import type { InboxFile, InboxPage } from "@hop/shared";
import { api } from "./api";
import { zipEntryNames } from "./zipNames";

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream> }>;

function savePicker(): SaveFilePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
}

/** Whether this browser can stream a zip straight to disk (Chromium desktop). */
export function canStreamZip(): boolean {
  return typeof savePicker() === "function";
}

export async function fileUrl(fileId: string, download: boolean) {
  const { url } = await api<{ url: string }>(
    `/me/files/${fileId}/url${download ? "?download=1" : ""}`,
  );
  return url;
}

/** Signed download URLs for many files, fetched in batches. */
export async function downloadUrls(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { urls } = await api<{ urls: { id: string; url: string }[] }>("/me/files/urls", {
      method: "POST",
      json: { ids: ids.slice(i, i + 100), download: true },
    });
    for (const { id, url } of urls) result.set(id, url);
  }
  return result;
}

/** Every file in the inbox (or one hop), not just the pages loaded on screen. */
export async function listAllFiles(hopId: string | null): Promise<InboxFile[]> {
  const all: InboxFile[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams();
    if (hopId) params.set("hopId", hopId);
    if (cursor) params.set("cursor", cursor);
    const page: InboxPage = await api<InboxPage>(`/me/files?${params}`);
    all.push(...page.files);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Zips files on the fly straight into a file the user picks, so gigabytes of
 * video never sit in memory. Only call when canStreamZip() is true.
 */
export async function zipToDisk(files: InboxFile[], zipName: string) {
  const picker = savePicker();
  if (!picker) throw new Error("Streaming downloads aren't supported in this browser");
  const handle = await picker({
    suggestedName: zipName,
    types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
  });
  const writable = await handle.createWritable();
  const { downloadZip } = await import("client-zip");
  const names = zipEntryNames(files);
  async function* entries() {
    for (const [i, file] of files.entries()) {
      const res = await fetch(await fileUrl(file.id, true));
      if (!res.ok) throw new Error(`Couldn't fetch ${file.name}`);
      yield { name: names[i] as string, input: res, lastModified: new Date(file.createdAt) };
    }
  }
  const zip = downloadZip(entries()).body;
  if (!zip) throw new Error("Zip stream unavailable");
  await zip.pipeTo(writable);
}
