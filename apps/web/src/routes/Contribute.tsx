import { type PublicConfig, type PublicHop, randomContributorName } from "@hop/shared";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Film, ImageIcon, RotateCcw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { ApiError, api, fetchMe, signInUrl } from "../lib/api";
import { formatBytes } from "../lib/format";
import { PassError, Uploader, type UploadItem } from "../lib/uploader";

const NAME_KEY = "hop:contributorName";

function storedName(): string {
  try {
    const existing = localStorage.getItem(NAME_KEY);
    if (existing) return existing;
    const generated = randomContributorName();
    localStorage.setItem(NAME_KEY, generated);
    return generated;
  } catch {
    return randomContributorName();
  }
}

type Waiter = { resolve: (pass: string) => void; reject: (error: Error) => void };

/**
 * Hands the uploader a valid hop pass, running Turnstile when there isn't one.
 * Turnstile tokens are single-use: a failure fails the waiting uploads (they
 * can be retried) instead of leaving them hanging, and the next getPass() or
 * the retry button starts a fresh check. There's deliberately no automatic
 * reset on failure, which would loop on persistent errors like rate limiting.
 */
function usePass(hopId: string | undefined) {
  const pass = useRef<{ value: string; expiresAt: number } | null>(null);
  const waiters = useRef<Waiter[]>([]);
  const verifying = useRef(true); // the widget starts a check as soon as it renders
  const turnstile = useRef<TurnstileInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((message: string) => {
    verifying.current = false;
    setError(message);
    for (const waiter of waiters.current.splice(0)) waiter.reject(new PassError(message));
  }, []);

  const onToken = useCallback(
    async (token: string) => {
      if (!hopId) return;
      verifying.current = true;
      try {
        const res = await api<{ pass: string; expiresAt: number }>(`/hops/${hopId}/pass`, {
          method: "POST",
          json: { turnstileToken: token },
        });
        pass.current = { value: res.pass, expiresAt: res.expiresAt };
        verifying.current = false;
        setError(null);
        for (const waiter of waiters.current.splice(0)) waiter.resolve(res.pass);
      } catch (e) {
        fail(e instanceof ApiError ? e.message : "We couldn't verify you're human. Tap retry.");
      }
    },
    [hopId, fail],
  );

  const onWidgetError = useCallback(
    () => fail("We couldn't verify you're human. Tap retry."),
    [fail],
  );

  const retry = useCallback(() => {
    verifying.current = true;
    setError(null);
    turnstile.current?.reset();
  }, []);

  const getPass = useCallback(() => {
    const current = pass.current;
    if (current && current.expiresAt - Date.now() > 60_000) return Promise.resolve(current.value);
    pass.current = null;
    const promise = new Promise<string>((resolve, reject) =>
      waiters.current.push({ resolve, reject }),
    );
    if (!verifying.current) retry();
    return promise;
  }, [retry]);

  return { getPass, onToken, onWidgetError, retry, turnstile, error };
}

function ItemRow({ item, uploader }: { item: UploadItem; uploader: Uploader }) {
  const progress = item.file.size ? item.uploadedBytes / item.file.size : 0;
  const Icon = item.file.type.startsWith("image/") ? ImageIcon : Film;
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.file.name}</p>
          <p className="shrink-0 text-xs text-black/50 tabular-nums dark:text-white/50">
            {item.status === "uploading"
              ? `${Math.floor(progress * 100)}%`
              : item.status === "finishing"
                ? "Finishing…"
                : formatBytes(item.file.size)}
          </p>
        </div>
        {item.status === "error" ? (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{item.error}</p>
        ) : (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] ${item.status === "done" ? "bg-hop-strong" : "bg-ink dark:bg-paper"}`}
              style={{ width: `${item.status === "done" ? 100 : Math.max(2, progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {item.status === "done" && <CheckCircle2 className="size-5 shrink-0 text-hop-strong" />}
      {item.status === "error" && (
        <button
          type="button"
          className="btn-ghost size-9 p-0"
          onClick={() => uploader.retry(item.id)}
          title="Retry"
        >
          <RotateCcw className="size-4" />
        </button>
      )}
      {(item.status === "queued" || item.status === "uploading" || item.status === "error") && (
        <button
          type="button"
          className="btn-ghost size-9 p-0"
          onClick={() => uploader.cancel(item.id)}
          title="Cancel"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}

export function Contribute({ handle, slug }: { handle: string; slug?: string }) {
  const hopQuery = useQuery({
    queryKey: ["public-hop", handle, slug],
    queryFn: () => api<PublicHop>(slug ? `/h/${handle}/${slug}` : `/h/${handle}`),
    retry: false,
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/config") });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  const hop = hopQuery.data;
  const [name, setName] = useState(storedName);
  const nameRef = useRef(name);
  nameRef.current = name;

  const {
    getPass,
    onToken,
    onWidgetError,
    retry: retryPass,
    turnstile,
    error: passError,
  } = usePass(hop?.id);
  const getName = useCallback(() => nameRef.current.trim() || undefined, []);
  const hopId = hop?.id;
  const uploader = useMemo(
    () => (hopId ? new Uploader(hopId, getPass, getName) : null),
    [hopId, getPass, getName],
  );
  const [items, setItems] = useState<UploadItem[]>([]);
  useEffect(() => uploader?.subscribe(setItems), [uploader]);

  const busy = items.some(
    (i) => i.status === "queued" || i.status === "uploading" || i.status === "finishing",
  );
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const saveName = (value: string) => {
    setName(value);
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch {}
  };

  if (hopQuery.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-black/50 dark:text-white/50">
        Loading…
      </div>
    );
  }
  if (!hop) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
        <div>
          <Logo />
          <h1 className="mt-8 text-3xl font-black tracking-tight">No Hop here</h1>
          <p className="mt-2 text-black/60 dark:text-white/60">
            Double-check the link. It should look like onmyhop.com/handle.
          </p>
        </div>
      </main>
    );
  }

  const ownerLabel = hop.owner.name || `@${hop.owner.handle}`;
  const doneCount = items.filter((i) => i.status === "done").length;
  const signedInAs = me.data ? (me.data.handle ? `@${me.data.handle}` : me.data.name) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-6 pb-10">
      <Logo />
      <section className="mt-10">
        <p className="text-sm font-medium text-black/60 dark:text-white/60">@{hop.owner.handle}</p>
        <h1 className="mt-1 text-4xl font-black leading-tight tracking-tight">
          Upload it on {ownerLabel}’s Hop
        </h1>
        {hop.slug !== "inbox" && <p className="mt-2 text-lg font-semibold">{hop.title}</p>}
        <p className="mt-3 text-black/60 dark:text-white/60">
          Send the videos and photos you took. Only {ownerLabel} can see them.
        </p>
      </section>

      {hop.status === "closed" ? (
        <div className="card mt-8 text-center">
          <p className="font-semibold">This Hop is closed</p>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            It isn’t accepting uploads right now.
          </p>
        </div>
      ) : (
        <>
          <div className="card mt-8">
            {signedInAs ? (
              <p className="text-sm">
                Uploading as <span className="font-semibold">{signedInAs}</span>
              </p>
            ) : (
              <>
                <label htmlFor="contributor-name" className="text-sm font-medium">
                  Your name
                </label>
                <input
                  id="contributor-name"
                  className="input mt-2"
                  value={name}
                  maxLength={40}
                  onChange={(e) => saveName(e.target.value)}
                />
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  So {ownerLabel} knows who filmed it.{" "}
                  <a className="underline" href={signInUrl()}>
                    Sign in with Caliplaces
                  </a>{" "}
                  to use your own name.
                </p>
              </>
            )}
          </div>

          <label className="btn-primary mt-4 w-full cursor-pointer py-4 text-base">
            <Upload className="size-5" />
            {items.length ? "Add more" : "Choose videos"}
            <input
              type="file"
              className="sr-only"
              multiple
              accept="video/*,image/*"
              onChange={(e) => {
                if (e.target.files) uploader?.add([...e.target.files]);
                e.target.value = "";
              }}
            />
          </label>

          {config.data && (
            <div className="mt-4 flex justify-center">
              <Turnstile
                ref={turnstile}
                siteKey={config.data.turnstileSiteKey}
                options={{ size: "flexible", appearance: "interaction-only", action: "upload" }}
                onSuccess={onToken}
                onError={onWidgetError}
                onExpire={retryPass}
              />
            </div>
          )}
          {passError && (
            <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <CircleAlert className="size-4 shrink-0" />
              <span className="flex-1">{passError}</span>
              <button type="button" className="font-semibold underline" onClick={retryPass}>
                Retry
              </button>
            </div>
          )}

          {items.length > 0 && (
            <section className="card mt-6">
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  {doneCount} of {items.length} sent
                </p>
                {!busy && doneCount > 0 && (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => uploader?.clearFinished()}
                  >
                    Clear
                  </button>
                )}
              </div>
              <ul className="mt-2 divide-y divide-black/5 dark:divide-white/10">
                {items.map(
                  (item) => uploader && <ItemRow key={item.id} item={item} uploader={uploader} />,
                )}
              </ul>
              {busy && (
                <p className="mt-3 text-xs text-black/50 dark:text-white/50">
                  Keep this page open until everything is sent.
                </p>
              )}
              {!busy && doneCount > 0 && (
                <p className="mt-3 text-sm font-medium">
                  Thanks! {ownerLabel} will find them in their Hop.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
