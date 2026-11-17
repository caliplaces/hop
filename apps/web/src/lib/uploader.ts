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
  /** The failure was the network (or a temporary server error), so reconnecting can resume it. */
  retryable?: boolean;
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

function sameFile(a: File, b: File) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/** Thrown by getPass when the human check failed; the message is shown to the user. */
export class PassError extends Error {}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Settles with `promise`, or rejects as soon as `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return abortable(new Promise((resolve) => setTimeout(resolve, ms)), signal);
}

function waitForOnline(signal: AbortSignal): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  return abortable(
    new Promise((resolve) => window.addEventListener("online", () => resolve(), { once: true })),
    signal,
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
    if (signal.aborted) return reject(abortError());
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
    /** The sender's note, read as each upload starts: it goes with the clips sent after it. */
    private readonly getNote: () => string | undefined = () => undefined,
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
      // Picking the same file again while it's still in the queue would start a
      // second upload sharing the first one's resume state.
      const duplicate = this.items.some((i) => i.status !== "cancelled" && sameFile(i.file, file));
      if (!duplicate) {
        this.items.push({ id: crypto.randomUUID(), file, status: "queued", uploadedBytes: 0 });
      }
    }
    this.emit();
    this.pump();
  }

  retry(id: string) {
    this.update(id, { status: "queued", error: undefined, retryable: undefined });
    this.pump();
  }

  /** Re-queue everything that failed for network reasons, e.g. when the device comes back online. */
  retryFailed() {
    const failed = this.items.filter((i) => i.status === "error" && i.retryable);
    for (const item of failed) {
      this.update(item.id, { status: "queued", error: undefined, retryable: undefined });
    }
    if (failed.length) this.pump();
  }

  cancel(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status === "done") return;
    this.controllers.get(id)?.abort();
    this.update(id, { status: "cancelled" });
    const key = sessionKey(this.hopId, item.file);
    const session = loadSession(key);
    saveSession(key, null);
    if (session) void this.discard(session);
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
        const pass = await abortable(this.getPass(), controller.signal);
        // The create request itself is never aborted: once it reaches the
        // server, its response is the only way to learn the upload's id and
        // clean it up. Cancelling only stops waiting for it, and whenever the
        // response arrives, an upload that was cancelled meanwhile is deleted.
        const creating = api<CreateUploadResult>(`/hops/${this.hopId}/uploads`, {
          method: "POST",
          headers: { "x-hop-pass": pass },
          json: {
            name: item.file.name,
            size: item.file.size,
            type: item.file.type || "application/octet-stream",
            contributorName: this.getContributorName(),
            note: this.getNote(),
          },
        });
        creating.then(
          (created) => {
            if (controller.signal.aborted) void this.discard(created);
          },
          () => {}, // failures are handled by the awaited copy below
        );
        const created = await abortable(creating, controller.signal);
        if (controller.signal.aborted) return; // cancelled just as it resolved; handled above
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
      const message =
        error instanceof ApiError || error instanceof PassError
          ? error.message
          : "Upload interrupted. Tap retry.";
      const rejected = error instanceof ApiError && error.status < 500 && error.status !== 429;
      if (rejected) saveSession(key, null);
      // Network failures (no ApiError) and server hiccups resume on reconnect;
      // rejections (too big, Hop closed, …) and failed human checks need the user.
      const retryable = !rejected && !(error instanceof PassError);
      this.update(item.id, { status: "error", error: message, retryable });
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

    // One controller per attempt: the first fatal error stops every sibling
    // worker, and all of them settle before this returns, so a retry never
    // overlaps workers (and saved progress) from an earlier attempt.
    const attempt = new AbortController();
    const stopAttempt = () => attempt.abort();
    signal.addEventListener("abort", stopAttempt, { once: true });
    const partSignal = attempt.signal;

    const urls = new Map<number, string>();
    const sign = async (numbers: number[]) => {
      const { parts } = await api<{ parts: SignedPart[] }>(`/uploads/${session.fileId}/parts`, {
        method: "POST",
        signal: partSignal,
        headers: { authorization: `Bearer ${session.uploadToken}` },
        json: { partNumbers: numbers },
      });
      for (const p of parts) urls.set(p.partNumber, p.url);
    };

    const queue = [...pending];
    const work = async () => {
      while (queue.length > 0) {
        const n = queue.shift() as number;
        for (let tries = 1; ; tries++) {
          if (partSignal.aborted) throw abortError();
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
              partSignal,
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
            if (partSignal.aborted || tries >= MAX_PART_ATTEMPTS) throw error;
            // Expired or rejected signature: get a fresh URL next time round.
            if (error instanceof PartError && (error.status === 403 || error.status === 400))
              urls.delete(n);
            await waitForOnline(partSignal);
            await sleep(Math.min(16_000, 1000 * 2 ** (tries - 1)), partSignal);
          }
        }
      }
    };
    const worker = async () => {
      try {
        await work();
      } catch (error) {
        attempt.abort();
        throw error;
      }
    };
    const results = await Promise.allSettled(Array.from({ length: PARTS_IN_PARALLEL }, worker));
    signal.removeEventListener("abort", stopAttempt);
    const errors = results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
    // Report the error that caused the stop, not the aborts it triggered.
    const cause = errors.find((e) => !isAbort(e)) ?? errors[0];
    if (cause !== undefined) throw cause;
  }

  private async discard(upload: Pick<CreateUploadResult, "fileId" | "uploadToken">) {
    await api(`/uploads/${upload.fileId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${upload.uploadToken}` },
    }).catch(() => {});
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
