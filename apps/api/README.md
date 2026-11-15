# @hop/api

One Cloudflare Worker that serves the API under `/api/*` and the web app's static build for every other path.

## Local development

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in the values
pnpm --filter @hop/api db:migrate:local
pnpm dev                                           # web on :5173, API on :8787
```

Open http://localhost:5173. Vite proxies `/api` to `wrangler dev`.

Without R2 S3 credentials in `.dev.vars`, upload parts and downloads go through dev-only Worker routes (`/api/dev/*`) against the local R2 simulator. Those routes are disabled outside `ENVIRONMENT=development`. Staging and production always use presigned R2 URLs, so file bytes never pass through the Worker.

To sign in locally, register your own **web** app at [developer.caliplaces.com/apps](https://developer.caliplaces.com/apps) with the redirect URI `http://localhost:5173/api/auth/callback`, and put its client ID and secret in `.dev.vars`. Each environment (local, staging, production) uses a separate developer app, so production credentials never reach dev machines.

The iPhone app signs in through its own developer app, `OIDC_APP_CLIENT_ID` in `wrangler.jsonc`. It's a **Native** app: a public client with PKCE and no secret, whose redirect URI is the custom scheme `com.onmyhop.app:/auth/callback`. Because nothing about it is secret or tied to a host, every environment, including local development, uses the same one.

## How the app signs in

1. `POST /api/auth/app/start` returns Caliplaces' authorization URL and a signed `flow` holding its state, nonce and PKCE verifier.
2. The app opens the URL in a web authentication session. Caliplaces redirects back to `com.onmyhop.app:/auth/callback?code=…&state=…`.
3. `POST /api/auth/app/session` with the `flow` and that URL checks the redirect and state, exchanges the code with the verifier, and returns a session token. Someone who intercepts the redirect gets a code they can't use without the verifier.
4. The app sends the token as `Authorization: Bearer <token>`. App sessions last 90 days from last use. They're stored as `kind = "app"`, and the website's cookie sessions as `"web"`, so neither kind is accepted in place of the other.

## How uploads work

1. The contributor page solves Turnstile once. `POST /api/hops/:hopId/pass` returns a signed pass that's valid for 2 hours. One pass can have at most 6 active and 300 total uploads.
2. `POST /api/hops/:hopId/uploads` checks the Hop and the declared type, and reserves quota atomically. Only completed files and uploads active in the last hour count against the quota, so abandoned uploads can't make a Hop look full. It then starts an R2 multipart upload and returns a `fileId` plus a per-file upload token.
3. `POST /api/uploads/:fileId/parts` returns presigned `UploadPart` URLs, with `Content-Length` signed into each one. The browser PUTs 10 MiB parts straight to R2, and a URL won't accept more bytes than its part should have.
4. `POST /api/uploads/:fileId/complete` completes the upload and checks the final size. It then reads the first bytes to work out the real media type, which decides the stored MIME type and file extension. Anything else is deleted. Retrying it is safe.
5. The browser grabs a frame and uploads a small JPEG thumbnail with `PUT /api/uploads/:fileId/thumbnail`. The body is read with a hard 512 KiB cap.

An hourly cron aborts uploads with no activity for 24 hours and deletes expired sessions. The bucket's lifecycle rule is a second safety net.

## Cloudflare setup (one time per environment)

Replace `staging` with `production` for production.

```sh
# Storage and database
wrangler r2 bucket create hop-staging
wrangler r2 bucket cors set hop-staging --file apps/api/infra/r2-cors.staging.json
wrangler r2 bucket lifecycle add hop-staging abort-multipart --abort-multipart-days 3
wrangler d1 create hop-staging        # put the database_id into wrangler.jsonc

# Secrets
wrangler secret put OIDC_CLIENT_SECRET --env staging
wrangler secret put SESSION_SECRET --env staging          # openssl rand -base64 32
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put R2_ACCOUNT_ID --env staging
wrangler secret put R2_ACCESS_KEY_ID --env staging        # R2 API token, Object Read & Write, this bucket only
wrangler secret put R2_SECRET_ACCESS_KEY --env staging
wrangler secret put RESEND_API_KEY --env staging          # Resend API key, Sending access, onmyhop.com only
wrangler secret put APNS_KEY --env staging < AuthKey.p8   # APNs key for this environment (see Live Activity pushes)
```

You also need to:

- Fill in `OIDC_CLIENT_ID` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
- Register `https://staging.onmyhop.com/api/auth/callback` on the Caliplaces developer app.
- Verify the app's domain with the DNS TXT record, which removes the "unverified app" warning and the 100-user cap.

## Emails

Hop sends its own emails through [Resend](https://resend.com) from `EMAIL_FROM` (see `wrangler.jsonc`); sign-in emails come from Caliplaces auth. Templates live in `src/email/` as JSX components that hono/jsx renders to table-based HTML with inline styles, with a plain-text version alongside. Each email goes only to verified addresses, and carries an idempotency key so retries never send it twice.

| Email     | When                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Welcome   | An athlete claims their handle                                                                             |
| New clips | Clips arrived and uploads have been quiet for 10 minutes, or an hour after the first one (`src/notify.ts`) |

The new-clips digest runs every 5 minutes. A clip counts as announced once `files.notified_at` is set; each run claims an athlete's unannounced clips in one statement before sending, and hands them back if the send fails. Athletes turn it off in account settings, from the unsubscribe link in each email (a page that asks first), or with their mail app's one-click unsubscribe (`List-Unsubscribe`, RFC 8058).

While `pnpm dev` runs, open [localhost:5173/email-lab.html](http://localhost:5173/email-lab.html) to see every email with sample data, in each colour, at phone and desktop width, and in dark mode. Without `RESEND_API_KEY` in `.dev.vars`, emails are printed to the wrangler console instead of sent.

The Bobble images in emails are rendered per colour by `pnpm --filter @hop/web mascot:assets email` into `apps/web/public/email/`.

## Live Activity pushes

The iPhone app's Event mode shows a Live Activity counting the clips that come in. The API keeps it counting with the phone locked, by pushing an update through Apple's push service (APNs) each time an upload completes (`src/live.ts`).

- The app registers the Live Activity's push token with `PUT /api/me/live-activities/:token`. It registers again when Apple rotates the token or the app relaunches, and removes the token with `DELETE` when Event mode ends. Registrations expire after 12 hours, like the Live Activity, and each athlete keeps at most five.
- Each update carries the clips that finished uploading since Event mode started, and who sent the latest. The first clip, and then at most one every 5 minutes, also lights up the screen, silently. Tokens Apple no longer accepts are forgotten.
- Each environment has its own APNs key, restricted to the `com.onmyhop.app` topic: a sandbox key for staging (debug builds) and a production key for production (TestFlight and App Store builds). The key is the `APNS_KEY` secret; its ID and environment are `APNS_KEY_ID` and `APNS_ENVIRONMENT` in `wrangler.jsonc`. Without the secret, nothing is pushed.
- `wrangler dev` can't reach APNs, so try pushes on staging. Locally, `POST /api/dev/hops/:hopId/arrivals` lands a fake clip in an event, for trying Event mode without uploading anything.

## Deploys

CI deploys every merge: `staging` goes to staging.onmyhop.com and `main` to onmyhop.com. It applies D1 migrations first, then deploys the Worker (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). To redeploy without a new merge, run the CI workflow manually on that branch.

Deploys need a Cloudflare API token (the "Edit Cloudflare Workers" template plus Account › D1 › Edit, limited to this account and the onmyhop.com zone). It's stored as the `CLOUDFLARE_API_TOKEN` secret on the `staging` and `production` GitHub environments. Each environment only accepts deploys from its own branch. The account ID is the `CLOUDFLARE_ACCOUNT_ID` repository variable.

Migrations run before the new Worker goes live, so each one must still work with the previous release.
