import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "../../lib/api";
import { PassError } from "../../lib/uploader";

type Waiter = { resolve: (pass: string) => void; reject: (error: Error) => void };

/**
 * Hands the uploader a valid hop pass, running Turnstile when there isn't one.
 * Turnstile tokens are single-use: a failure fails the waiting uploads (they
 * can be retried) instead of leaving them hanging, and the next getPass() or
 * the retry button starts a fresh check. There's deliberately no automatic
 * reset on failure, which would loop on persistent errors like rate limiting.
 */
export function usePass(hopId: string | undefined) {
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
