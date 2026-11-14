import type { ApiError as ApiErrorBody, Me } from "@hop/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

export async function api<T>(path: string, { json, headers, ...init }: Options = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error ?? "error",
      body?.message ?? "Something went wrong.",
    );
  }
  return (await res.json()) as T;
}

export function fetchMe() {
  return api<{ me: Me | null }>("/me").then((r) => r.me);
}

export function signInUrl(returnTo = window.location.pathname) {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function signOut() {
  await api("/auth/logout", { method: "POST" });
  window.location.assign("/");
}
