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
  /** Per account, or per IP for page reports: reports and blocks. */
  REPORT_LIMITER: RateLimit;
  /** Per account, on profile changes: name and photo. */
  PROFILE_LIMITER: RateLimit;
  /** Per account, on the website's Hop+ calls that reach Stripe. */
  BILLING_LIMITER: RateLimit;

  ENVIRONMENT: "development" | "staging" | "production";
  APP_URL: string;
  OIDC_ISSUER: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  /** The iPhone app's own (Native, public) Caliplaces developer app. Empty disables app sign-in. */
  OIDC_APP_CLIENT_ID: string;
  /**
   * How the app is sent back after signing in: "https" to this site's
   * callback page, which only Hop can catch, or "scheme" for the older
   * custom scheme. See appRedirectUri.
   */
  OIDC_APP_REDIRECT: "https" | "scheme";
  SESSION_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  R2_BUCKET_NAME: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Sender for Hop's emails, e.g. "Hop <hello@onmyhop.com>". */
  EMAIL_FROM: string;
  /** Where reports of clips and pages go: Hop's team. */
  REPORTS_EMAIL: string;
  /**
   * Hop's team: account IDs (usr_…), comma-separated, who may see the
   * private stats page (/admin). A secret, so the list isn't in the repo.
   */
  ADMIN_USER_IDS?: string;
  /** Resend API key. Optional locally, where emails are logged instead of sent. */
  RESEND_API_KEY?: string;
  /**
   * The signing secret (whsec_…) of Resend's webhook to this environment,
   * which reports bounces and spam complaints (routes/email.ts). Without it
   * the webhook isn't there.
   */
  RESEND_WEBHOOK_SECRET?: string;
  /**
   * When the launch email goes out (ISO 8601), for trying it on staging
   * early. Defaults to LAUNCH_AT in packages/shared.
   */
  LAUNCH_AT?: string;
  /** The App Store page, once the app is out; the launch email links it. */
  APP_STORE_URL?: string;
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
  /**
   * Hop+ on the website, through Stripe (lib/stripe.ts). STRIPE_SECRET_KEY
   * is the API key, a restricted one will do; STRIPE_WEBHOOK_SECRET is the
   * webhook endpoint's signing secret (whsec_…). Both are secrets: test mode
   * locally and on staging, live mode in production. Without them the
   * website doesn't sell Hop+.
   */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * The Hop+ product in that Stripe account (prod_…). Its active monthly and
   * yearly prices are what the website sells; nothing else there counts.
   */
  STRIPE_PRODUCT_ID: string;
  /**
   * Hop's own customer portal settings (bpc_…): Hop+ prices only, cancelling
   * at the period's end. Without it, the account's default is used, which
   * its other products share.
   */
  STRIPE_PORTAL_CONFIGURATION?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: UserRow | null; sessionId: string | null };
};
