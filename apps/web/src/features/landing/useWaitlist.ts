import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { queries } from "../../lib/queries";
import { joinedEmail, joinWaitlist, looksLikeEmail, rememberJoined } from "./waitlist";

export type WaitlistStatus =
  | { kind: "idle" }
  | { kind: "verifying" } // waiting for Turnstile before sending
  | { kind: "sending" }
  | { kind: "joined"; email: string }
  | { kind: "error"; message: string };

const HUMAN_CHECK_FAILED = "We couldn’t check you’re human. Please try again.";
const GENERIC_ERROR = "We couldn’t add you just now. Please try again in a moment.";

/** Gives up on a human check that never answers, e.g. when its script is blocked. */
const VERIFY_TIMEOUT_MS = 30_000;

/**
 * One waitlist shared by every form on the page, so joining in the hero also
 * updates the form at the bottom. Turnstile (and the config holding its site
 * key) loads only once someone starts using a form, and renders in that form.
 * Tokens are single-use: each send uses a fresh one.
 */
export function useWaitlist() {
  const [activeForm, setActiveForm] = useState<string | null>(null);
  const [status, setStatus] = useState<WaitlistStatus>(() => {
    const email = joinedEmail();
    return email ? { kind: "joined", email } : { kind: "idle" };
  });
  const config = useQuery({ ...queries.config(), enabled: activeForm !== null });
  const siteKey = config.data?.turnstileSiteKey || undefined;
  const turnstile = useRef<TurnstileInstance | null>(null);
  const token = useRef<string | null>(null);
  const pendingEmail = useRef<string | null>(null);

  const send = useCallback(async (email: string, turnstileToken?: string) => {
    setStatus({ kind: "sending" });
    try {
      await joinWaitlist({ email, turnstileToken });
      rememberJoined(email);
      setStatus({ kind: "joined", email });
    } catch (error) {
      const known = error instanceof ApiError && error.status < 500 && error.status !== 404;
      setStatus({ kind: "error", message: known ? error.message : GENERIC_ERROR });
      turnstile.current?.reset();
    }
  }, []);

  // A form was submitted before the config arrived, and it turned out there's
  // no site key (or no config): nothing will mint a token, so send without one.
  useEffect(() => {
    const email = pendingEmail.current;
    if (config.isPending || siteKey || !email) return;
    pendingEmail.current = null;
    void send(email);
  }, [config.isPending, siteKey, send]);

  useEffect(() => {
    if (status.kind !== "verifying") return;
    const id = setTimeout(() => {
      pendingEmail.current = null;
      setStatus({ kind: "error", message: HUMAN_CHECK_FAILED });
    }, VERIFY_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [status.kind]);

  /** Typing again clears an error about what was typed before. */
  const clearError = useCallback(
    () => setStatus((current) => (current.kind === "error" ? { kind: "idle" } : current)),
    [],
  );

  /** Called when a form is focused or touched: loads Turnstile into that form. */
  const arm = useCallback((formId: string) => setActiveForm(formId), []);

  const submit = useCallback(
    (formId: string, raw: string) => {
      const email = raw.trim();
      setActiveForm(formId);
      if (!looksLikeEmail(email)) {
        setStatus({ kind: "error", message: "That doesn’t look like an email address." });
        return;
      }
      // Without a site key (local development, or the config failed to load)
      // the API makes the call; while the config is still loading, wait for it.
      const needsToken = config.isPending || Boolean(siteKey);
      if (needsToken && !token.current) {
        pendingEmail.current = email;
        setStatus({ kind: "verifying" });
        return;
      }
      const used = token.current ?? undefined;
      token.current = null;
      void send(email, used);
    },
    [config.isPending, siteKey, send],
  );

  const onToken = useCallback(
    (value: string) => {
      const email = pendingEmail.current;
      if (!email) {
        token.current = value;
        return;
      }
      pendingEmail.current = null;
      void send(email, value);
    },
    [send],
  );

  const onTokenExpired = useCallback(() => {
    token.current = null;
  }, []);

  const onWidgetError = useCallback(() => {
    token.current = null;
    if (!pendingEmail.current) return;
    pendingEmail.current = null;
    setStatus({ kind: "error", message: HUMAN_CHECK_FAILED });
  }, []);

  return {
    status,
    activeForm,
    siteKey,
    turnstile,
    arm,
    submit,
    clearError,
    onToken,
    onTokenExpired,
    onWidgetError,
  };
}

export type Waitlist = ReturnType<typeof useWaitlist>;
