import type { InboxFile } from "@hop/shared";
import { api } from "./api";

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream> }>;

export async function fileUrl(fileId: string, download: boolean) {
  const { url } = await api<{ url: string }>(
    `/me/files/${fileId}/url${download ? "?download=1" : ""}`,
  );
  return url;
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

/** Zip entry names grouped by contributor, de-duplicated. */
function zipNames(files: InboxFile[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const folder = (f.contributorName ?? "Unknown").replace(/[\\/:*?"<>|]/g, "_");
    const base = `${folder}/${f.name.replace(/[\\/]/g, "_")}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    const dot = base.lastIndexOf(".");
    return dot > folder.length
      ? `${base.slice(0, dot)} (${count})${base.slice(dot)}`
      : `${base} (${count})`;
  });
}

/**
 * Downloads several files. Where the browser can stream to disk (File System
 * Access API) they're zipped on the fly without holding gigabytes in memory;
 * elsewhere each file downloads separately.
 */
export async function downloadFiles(files: InboxFile[], zipName = "hop.zip") {
  if (files.length === 0) return;
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (files.length > 1 && picker) {
    const handle = await picker({
      suggestedName: zipName,
      types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
    });
    const writable = await handle.createWritable();
    const { downloadZip } = await import("client-zip");
    const names = zipNames(files);
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
    return;
  }
  for (const file of files) {
    triggerDownload(await fileUrl(file.id, true));
    await new Promise((r) => setTimeout(r, 400));
  }
}
