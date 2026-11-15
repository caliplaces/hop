import type { UserRow } from "./db/schema";

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  UPLOAD_LIMITER: RateLimit;
  /** Per IP, on the sign-in endpoints that call out to Caliplaces. */
  AUTH_LIMITER: RateLimit;

  ENVIRONMENT: "development" | "staging" | "production";
  APP_URL: string;
  OIDC_ISSUER: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  /** The iPhone app's own (Native, public) Caliplaces developer app. Empty disables app sign-in. */
  OIDC_APP_CLIENT_ID: string;
  SESSION_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  R2_BUCKET_NAME: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Sender for Hop's emails, e.g. "Hop <hello@onmyhop.com>". */
  EMAIL_FROM: string;
  /** Resend API key. Optional locally, where emails are logged instead of sent. */
  RESEND_API_KEY?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: UserRow | null; sessionId: string | null };
};
