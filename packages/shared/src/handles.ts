/**
 * Handles live at the root of onmyhop.com, so anything the app itself routes
 * (or might route later) is reserved.
 */
export const RESERVED_HANDLES = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "apps",
  "assets",
  "auth",
  "blog",
  "callback",
  "caliplaces",
  "contact",
  "dashboard",
  "download",
  "help",
  "hop",
  "hops",
  "inbox",
  "legal",
  "login",
  "logout",
  "me",
  "new",
  "onboarding",
  "pricing",
  "privacy",
  "settings",
  "signin",
  "signup",
  "static",
  "status",
  "support",
  "terms",
  "u",
  "upload",
  "uploads",
  "www",
]);

export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_.]{0,28}[a-z0-9]$/;

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export type HandleProblem = "invalid" | "reserved";

export function checkHandle(handle: string): HandleProblem | null {
  if (!HANDLE_PATTERN.test(handle) || handle.includes("..")) return "invalid";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

export const HOP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
