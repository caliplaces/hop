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
  "bobble",
  "callback",
  "caliplaces",
  "contact",
  "dashboard",
  "download",
  "email",
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
  "unsubscribe",
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

/**
 * Every athlete has one standing Hop, created with their handle. Its slug is
 * fixed (onmyhop.com/<handle>/inbox) and its default title is "Main", which
 * reads better next to the Inbox page than "Inbox" did.
 */
export const DEFAULT_HOP_SLUG = "inbox";
export const DEFAULT_HOP_TITLE = "Main";

export const HOP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function slugify(input: string): string {
  // Split into words rather than trimming dashes with an anchored regex, which
  // can backtrack polynomially on long runs of separators.
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-")
    .slice(0, 40);
  return slug.endsWith("-") ? slug.slice(0, -1) : slug;
}
