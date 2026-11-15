import type { JoinWaitlistInput, JoinWaitlistResult } from "@hop/shared";
import { api } from "../../lib/api";

export function joinWaitlist(input: JoinWaitlistInput) {
  return api<JoinWaitlistResult>("/waitlist", { method: "POST", json: input });
}

/**
 * Loose on purpose: the API validates properly. This only catches typos like a
 * missing "@" before a round trip, without shipping a validation library on
 * the landing page.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/*
 * Remembers in this browser that its visitor joined, so coming back shows
 * "you're on the list" instead of the form. Storage can be unavailable
 * (private mode, blocked cookies); then the form simply shows again.
 */
const JOINED_KEY = "hop:waitlist-joined";

export function rememberJoined(email: string) {
  try {
    localStorage.setItem(JOINED_KEY, email);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export function joinedEmail(): string | null {
  try {
    return localStorage.getItem(JOINED_KEY);
  } catch {
    return null;
  }
}
