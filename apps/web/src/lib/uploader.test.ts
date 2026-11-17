import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Uploader, type UploadItem } from "./uploader";

type Call = { url: string; method: string };

/** Minimal browser globals the uploader touches outside of part uploads. */
function installBrowserStubs() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  return store;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Uploader cancellation", () => {
  let calls: Call[];

  beforeEach(() => {
    installBrowserStubs();
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes an upload whose create request was still in flight when cancelled", async () => {
    const createResponse = deferred<Response>();
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      // The create request must not be aborted; it has to finish so it can be cleaned up.
      expect(init.signal).toBeUndefined();
      if (url.endsWith("/uploads") && init.method === "POST") return createResponse.promise;
      return Promise.resolve(json({ ok: true }));
    });

    const uploader = new Uploader(
      "hop_1",
      async () => "pass",
      () => "Tester",
    );
    const file = new File([new Uint8Array(2048)], "clip.mp4", { type: "video/mp4" });
    let items: { id: string; status: string }[] = [];
    uploader.subscribe((next) => {
      items = next;
    });

    uploader.add([file]);
    await flush();
    const id = items[0]?.id as string;
    uploader.cancel(id);
    await flush();
    expect(items[0]?.status).toBe("cancelled");

    // The server had already created it; the response arrives after the cancel.
    createResponse.resolve(
      json({ fileId: "fil_1", uploadToken: "tok", partSize: 2048, partCount: 1 }, 201),
    );
    await flush();
    await flush();

    expect(calls).toContainEqual({ url: "/api/uploads/fil_1", method: "DELETE" });
    expect(localStorage.getItem(`hop:upload:hop_1:clip.mp4:2048:${file.lastModified}`)).toBeNull();
  });

  it("sends each file with the note as it was when the file was added, retries too", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/uploads") && init.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
      }
      return new Promise(() => {});
    });
    let note: string | undefined;
    const uploader = new Uploader(
      "hop_1",
      async () => "pass",
      () => "Tester",
      () => note,
    );
    let items: UploadItem[] = [];
    uploader.subscribe((next) => {
      items = next;
    });
    uploader.add([new File([new Uint8Array(2048)], "a.mp4", { type: "video/mp4" })]);
    await flush();
    note = "Round 2";
    // Three at once: the third waits while two send, and keeps "Round 2"
    // even though the note changes before it starts.
    uploader.add(
      ["b.mp4", "c.mp4", "d.mp4"].map(
        (name) => new File([new Uint8Array(2048)], name, { type: "video/mp4" }),
      ),
    );
    await flush();
    note = "Round 3";
    // Cancelling the first frees a place, and the third starts now.
    uploader.cancel(items[0]?.id as string);
    await flush();
    await flush();
    expect(bodies).toMatchObject([
      { name: "a.mp4", contributorName: "Tester" },
      { name: "b.mp4", contributorName: "Tester", note: "Round 2" },
      { name: "c.mp4", contributorName: "Tester", note: "Round 2" },
    ]);
    expect(bodies[0]).not.toHaveProperty("note");
  });

  it("ignores picking the same file twice", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const uploader = new Uploader(
      "hop_1",
      () => new Promise(() => {}),
      () => undefined,
    );
    const file = new File([new Uint8Array(10)], "a.mp4", { type: "video/mp4", lastModified: 1 });
    let count = 0;
    uploader.subscribe((items) => {
      count = items.length;
    });
    uploader.add([file]);
    uploader.add([new File([new Uint8Array(10)], "a.mp4", { type: "video/mp4", lastModified: 1 })]);
    expect(count).toBe(1);
  });

  it("resumes network failures on retryFailed, but not rejected uploads", async () => {
    let failWith: "network" | "rejected" = "network";
    let creates = 0;
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/uploads") && init.method === "POST") {
        creates++;
        if (failWith === "network") return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(
          json({ error: "unsupported_type", message: "Only videos and photos." }, 415),
        );
      }
      return new Promise(() => {});
    });

    const uploader = new Uploader(
      "hop_1",
      async () => "pass",
      () => undefined,
    );
    let items: { status: string; retryable?: boolean }[] = [];
    uploader.subscribe((next) => {
      items = next;
    });

    uploader.add([
      new File([new Uint8Array(2048)], "a.mp4", { type: "video/mp4", lastModified: 1 }),
    ]);
    await flush();
    expect(items[0]).toMatchObject({ status: "error", retryable: true });

    failWith = "rejected";
    uploader.retryFailed();
    await flush();
    expect(creates).toBe(2);
    expect(items[0]).toMatchObject({ status: "error", retryable: false });

    uploader.retryFailed(); // a rejection isn't retried automatically
    await flush();
    expect(creates).toBe(2);
  });
});
