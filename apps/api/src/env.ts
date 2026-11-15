import type { UserRow } from "./db/schema";

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  UPLOAD_LIMITER: RateLimit;
  /** Per IP, on the sign-in endpoints that call out to Caliplaces. */
  AUTH_LIMITER: RateLimit;
  /** Per IP, on the launch waitlist. */
  WAITLIST_LIMITER: RateLimit;

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
  /**
   * Apple's push service, for Event mode's Live Activity. APNS_KEY is the .p8
   * signing key (PEM, a secret); without it nothing is pushed. The key is
   * restricted to APPLE_BUNDLE_ID and to one APNS_ENVIRONMENT.
   */
  APNS_KEY?: string;
  APNS_KEY_ID: string;
  APNS_ENVIRONMENT: "sandbox" | "production";
  APPLE_TEAM_ID: string;
  /** The iPhone app: its bundle ID, for pushes and for App Store purchases. */
  APPLE_BUNDLE_ID: string;
  /** The app's App Store ID, which production App Store notifications carry. */
  APPLE_APP_ID: string;
  /**
   * In production, the user IDs whose sandbox purchases count (comma
   * separated): App Review's demo account and the team's. Everyone else's
   * TestFlight purchases, which cost nothing, don't unlock Hop+. Unused
   * elsewhere, where sandbox purchases always count.
   */
  APPLE_SANDBOX_USERS?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: UserRow | null; sessionId: string | null };
};
