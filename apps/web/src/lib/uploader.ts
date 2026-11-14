import {
  type CompletedPart,
  type CreateUploadResult,
  MAX_PARTS_PER_SIGN_REQUEST,
  type SignedPart,
} from "@hop/shared";
import { ApiError, api } from "./api";
import { createThumbnail } from "./thumbnail";

export type UploadStatus = "queued" | "uploading" | "finishing" | "done" | "error" | "cancelled";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  uploadedBytes: number;
  error?: string;
};

type Session = CreateUploadResult & { etags: Record<number, string> };

const FILES_IN_PARALLEL = 2;
const PARTS_IN_PARALLEL = 4;
const MAX_PART_ATTEMPTS = 6;

function sessionKey(hopId: string, file: File) {
  return `hop:upload:${hopId}:${file.name}:${file.size}:${file.lastModified}`;
}

function loadSession(key: string): Session | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(key: string, session: Session | null) {
  try {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: resuming across reloads just won't work.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((resolve) =>
    window.addEventListener("online", () => resolve(), { once: true }),
  );
}

class PartError extends Error {
  constructor(readonly status: number) {
    super(`Part upload failed (${status})`);
  }
}

function putPart(
  url: string,
  body: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new PartError(xhr.status));
    };
    xhr.onerror = () => reject(new PartError(0));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

type Listener = (items: UploadItem[]) => void;

/**
 * Uploads files straight to R2 with multipart uploads: a few files at a time,
 * a few parts per file, retrying parts on flaky connections, and remembering
 * finished parts in localStorage so re-picking the same file after a reload
 * resumes instead of starting over.
 */
export class Uploader {
  private items: UploadItem[] = [];
  private listeners = new Set<Listener>();
  private controllers = new Map<string, AbortController>();
  private active = 0;
  private wakeLock: WakeLockSentinel | null = null;

  constructor(
    private readonly hopId: string,
    private readonly getPass: () => Promise<string>,
    private readonly getContributorName: () => string | undefined,
  ) {}

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.items);
    return () => {
      this.listeners.delete(listener);
    };
  }

  add(files: File[]) {
    for (const file of files) {
      this.items.push({ id: crypto.randomUUID(), file, status: "queued", uploadedBytes: 0 });
    }
    this.emit();
    this.pump();
  }

  retry(id: string) {
    this.update(id, { status: "queued", error: undefined });
    this.pump();
  }

  cancel(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status === "done") return;
    this.controllers.get(id)?.abort();
    this.update(id, { status: "cancelled" });
    const key = sessionKey(this.hopId, item.file);
    const session = loadSession(key);
    saveSession(key, null);
    if (session) {
      api(`/uploads/${session.fileId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.uploadToken}` },
      }).catch(() => {});
    }
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.status !== "done" && i.status !== "cancelled");
    this.emit();
  }

  private emit() {
    const snapshot = [...this.items];
    for (const listener of this.listeners) listener(snapshot);
  }

  private update(id: string, patch: Partial<UploadItem>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.emit();
  }

  private pump() {
    while (this.active < FILES_IN_PARALLEL) {
      const next = this.items.find((i) => i.status === "queued");
      if (!next) break;
      this.active++;
      this.update(next.id, { status: "uploading" });
      void this.holdWakeLock();
      this.upload(next).finally(() => {
        this.active--;
        if (this.active === 0) this.releaseWakeLock();
        this.pump();
      });
    }
  }

  private async upload(item: UploadItem): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    const key = sessionKey(this.hopId, item.file);
    try {
      let session = loadSession(key);
      if (!session) {
        const created = await api<CreateUploadResult>(`/hops/${this.hopId}/uploads`, {
          method: "POST",
          headers: { "x-hop-pass": await this.getPass() },
          json: {
            name: item.file.name,
            size: item.file.size,
            type: item.file.type || "application/octet-stream",
            contributorName: this.getContributorName(),
          },
        });
        session = { ...created, etags: {} };
        saveSession(key, session);
        void this.uploadThumbnail(item.file, session);
      }

      try {
        await this.uploadParts(item, session, key, controller.signal);
      } catch (error) {
        // The server forgot this upload (expired or cleaned up): start over once.
        if (error instanceof ApiError && error.status === 404) {
          saveSession(key, null);
          this.update(item.id, { uploadedBytes: 0 });
          return this.upload(item);
        }
        throw error;
      }

      this.update(item.id, { status: "finishing" });
      const parts: CompletedPart[] = Object.entries(session.etags).map(([n, etag]) => ({
        partNumber: Number(n),
        etag,
      }));
      await api(`/uploads/${session.fileId}/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.uploadToken}` },
        json: { parts },
      });
      saveSession(key, null);
      this.update(item.id, { status: "done", uploadedBytes: item.file.size });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof ApiError ? error.message : "Upload interrupted. Tap retry.";
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
        saveSession(key, null);
      }
      this.update(item.id, { status: "error", error: message });
    } finally {
      this.controllers.delete(item.id);
    }
  }

  private async uploadParts(item: UploadItem, session: Session, key: string, signal: AbortSignal) {
    const { file } = item;
    const pending: number[] = [];
    for (let n = 1; n <= session.partCount; n++) if (!session.etags[n]) pending.push(n);

    const partSize = (n: number) =>
      Math.min(session.partSize, file.size - (n - 1) * session.partSize);
    const doneBytes = () =>
      Object.keys(session.etags).reduce((sum, n) => sum + partSize(Number(n)), 0);
    const inFlight = new Map<number, number>();
    const report = () => {
      let bytes = doneBytes();
      for (const loaded of inFlight.values()) bytes += loaded;
      this.update(item.id, { uploadedBytes: Math.min(bytes, file.size) });
    };
    report();

    const urls = new Map<number, string>();
    const sign = async (numbers: number[]) => {
      const { parts } = await api<{ parts: SignedPart[] }>(`/uploads/${session.fileId}/parts`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.uploadToken}` },
        json: { partNumbers: numbers },
      });
      for (const p of parts) urls.set(p.partNumber, p.url);
    };

    const queue = [...pending];
    const worker = async () => {
      while (queue.length > 0) {
        const n = queue.shift() as number;
        for (let attempt = 1; ; attempt++) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (!urls.has(n)) {
            const batch = queue
              .filter((m) => !urls.has(m))
              .slice(0, MAX_PARTS_PER_SIGN_REQUEST - 1);
            await sign([n, ...batch]);
          }
          const start = (n - 1) * session.partSize;
          try {
            const etag = await putPart(
              urls.get(n) as string,
              file.slice(start, start + partSize(n)),
              signal,
              (loaded) => {
                inFlight.set(n, loaded);
                report();
              },
            );
            inFlight.delete(n);
            session.etags[n] = etag;
            saveSession(key, session);
            report();
            break;
          } catch (error) {
            inFlight.delete(n);
            report();
            if (signal.aborted || attempt >= MAX_PART_ATTEMPTS) throw error;
            // Expired or rejected signature: get a fresh URL next time round.
            if (error instanceof PartError && (error.status === 403 || error.status === 400))
              urls.delete(n);
            await waitForOnline();
            await sleep(Math.min(16_000, 1000 * 2 ** (attempt - 1)));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: PARTS_IN_PARALLEL }, worker));
  }

  private async uploadThumbnail(file: File, session: Session) {
    const thumbnail = await createThumbnail(file);
    if (!thumbnail) return;
    await fetch(`/api/uploads/${session.fileId}/thumbnail`, {
      method: "PUT",
      headers: { authorization: `Bearer ${session.uploadToken}`, "content-type": "image/jpeg" },
      body: thumbnail,
    }).catch(() => {});
  }

  private async holdWakeLock() {
    if (this.wakeLock || !("wakeLock" in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
    } catch {
      // Not allowed (e.g. page hidden); uploads still work.
    }
  }

  private releaseWakeLock() {
    void this.wakeLock?.release();
    this.wakeLock = null;
  }
}
