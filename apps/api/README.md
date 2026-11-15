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

The iPhone app signs in through its own developer app, `OIDC_APP_CLIENT_ID` in `wrangler.jsonc`. It's a **Native** app: a public client with PKCE and no secret, and every environment, including local development, uses the same one. Its redirect URIs are registered there: `https://onmyhop.com/api/auth/app/callback`, `https://staging.onmyhop.com/api/auth/app/callback`, and, until every environment has moved off it, the custom scheme `com.onmyhop.app:/auth/callback`.

## How the app signs in

1. `POST /api/auth/app/start` returns Caliplaces' authorization URL, a signed `flow` holding its state, nonce, PKCE verifier and redirect URI, and the `callback` the app should wait for.
2. The app opens the URL in a web authentication session. Caliplaces redirects back to that callback with `?code=…&state=…`, and the session catches it.
3. `POST /api/auth/app/session` with the `flow` and that URL checks the redirect and state, exchanges the code with the verifier, and returns a session token. Someone who intercepts the redirect gets a code they can't use without the verifier.

`OIDC_APP_REDIRECT` in `wrangler.jsonc` picks the callback per environment:

- `"https"`: `<APP_URL>/api/auth/app/callback`. Only Hop can catch it, because the app's `webcredentials` associated domains name this site, and the site lists the app in `/.well-known/apple-app-site-association`, which the Worker serves. If the page ever loads in a browser, it only says to go back to the app.
- `"scheme"`: the custom scheme `com.onmyhop.app:/auth/callback`, which another app could also claim. It's kept only while moving to https, and local development uses it.

A flow remembers its redirect URI, so changing the setting doesn't break a sign-in already under way.
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

## Launch waitlist

Until launch (December 1, 2026), the landing page collects a waitlist. `POST /api/waitlist` takes `{ email, turnstileToken }` (`joinWaitlistSchema` in `packages/shared/src/waitlist.ts`) and stores the email in the `waitlist` table, lowercased and once (`src/routes/waitlist.ts`).

- It always answers `{ ok: true }`, whether or not the email was already on the list, so nobody can probe it for addresses.
- Turnstile is required, minted with the `waitlist` action, so a token from the upload form doesn't count. Locally, a missing token is allowed.
- Each IP gets 10 tries a minute (`WAITLIST_LIMITER`).

The list is only for the launch email; `notified_at` records who has had it. To read it:

```sh
wrangler d1 execute hop-production --remote --env production \
  --command "select email, created_at from waitlist order by created_at"
```

## Live Activity pushes

The iPhone app's Event mode shows a Live Activity counting the clips that come in. The API keeps it counting with the phone locked, by pushing an update through Apple's push service (APNs) each time an upload completes (`src/live.ts`).

- The app registers the Live Activity's push token with `PUT /api/me/live-activities/:token`. It registers again when Apple rotates the token or the app relaunches, and removes the token with `DELETE` when Event mode ends. Registrations expire after 12 hours, like the Live Activity, and each athlete keeps at most five.
- Each update carries the clips that finished uploading since Event mode started, and who sent the latest. The first clip, and then at most one every 5 minutes, also lights up the screen, silently. Tokens Apple no longer accepts are forgotten.
- Each environment has its own APNs key, restricted to the `com.onmyhop.app` topic: a sandbox key for staging (debug builds) and a production key for production (TestFlight and App Store builds). The key is the `APNS_KEY` secret; its ID and environment are `APNS_KEY_ID` and `APNS_ENVIRONMENT` in `wrangler.jsonc`. Without the secret, nothing is pushed.
- `wrangler dev` can't reach APNs, so try pushes on staging. Locally, `POST /api/dev/hops/:hopId/arrivals` lands a fake clip in an event, for trying Event mode without uploading anything.

## Hop+ subscriptions

Athletes subscribe to Hop+ in the iPhone app, through the App Store. The plans are in `packages/shared/src/limits.ts`:

| Plan | Storage | Clips kept |
| ---- | ------- | ---------- |
| Free | 15 GB   | 30 days    |
| Hop+ | 200 GB  | Forever    |

The products are `hop_plus` (monthly) and `hop_plus_annual` (yearly), in one subscription group. Prices live only in App Store Connect; the app shows what StoreKit returns.

The API decides who has Hop+, and only from data Apple signed (`src/lib/apple.ts`). Each signed payload carries its certificate chain, which must lead to the pinned Apple Root CA G3 (`src/lib/apple-roots.ts`) through Apple's App Store signing certificates, as in Apple's own server library.

- `GET /api/me/plan` returns the plan, storage use and limit, and the athlete's `appAccountToken`. The app passes the token to StoreKit with each purchase, so Apple's records tie the purchase to this account.
- `POST /api/me/subscriptions/apple` takes a transaction from StoreKit, sent after a purchase, on restore, and as renewals arrive. It's only accepted when the transaction carries this account's token.
- `POST /api/apple/notifications` receives App Store Server Notifications V2 for renewals, lapses, billing grace periods and refunds, and credits the account whose token the purchase carries.

How a subscription's state is kept right:

- **Newest wins.** Data applies only when it's for a later purchase (a renewal, upgrade or resubscription), or for the same purchase signed later. Retries, late notifications and old transactions signed again can't roll a subscription back. Transactions superseded by an upgrade (`isUpgraded`) are ignored, as in Apple's sample code.
- **Ownership.** A subscription belongs to the account whose token is on its newest purchase. Restoring someone else's purchase is refused. If the same Apple ID later subscribes again from another Hop account, the subscription moves there, since only that Apple ID can make a new purchase for it.
- **Billing grace.** While Apple retries a failed renewal, Hop+ continues until the grace period ends. Only renewal info, which comes with notifications, starts it, and a newer purchase ends it. Renewal info is ordered by its own signing time, apart from the transaction's, so the app syncing a purchase can't hold back a grace period Apple delivers late. It only counts when it comes with the current purchase, so a late notification about an older one can't bring its grace period back.

- **Ordering replies.** Each athlete has a `plan_revision`, bumped in the same transaction as any change to their subscriptions (both accounts' when one moves). `GET /api/me/plan` and purchase replies read it first and return it as `revision`, so the rest of the reply is at least that new. The app never replaces a plan with one of a lower revision, whichever reply arrives last.

Upload quota checks use the plan at the moment of the upload (`src/lib/plans.ts`). Retention isn't enforced yet: no clip is deleted for being older than 30 days.

In App Store Connect, under the app's **App Information › App Store Server Notifications**, set Version 2 URLs:

- Production: `https://onmyhop.com/api/apple/notifications`
- Sandbox: `https://staging.onmyhop.com/api/apple/notifications`

Production notifications must name this app's Apple ID (`APPLE_APP_ID` in `wrangler.jsonc`).

### Sandbox purchases

App Review and TestFlight buy in the sandbox against production, and TestFlight subscriptions cost nothing. On production, sandbox purchases unlock Hop+ only for the accounts in the `APPLE_SANDBOX_USERS` secret: App Review's demo account and the team's. Anyone else gets `403 test_purchase`. Staging accepts every sandbox purchase.

```sh
# User IDs, comma separated
wrangler d1 execute hop-production --remote --env production \
  --command "select id from users where handle in ('demo', 'you')"
wrangler secret put APPLE_SANDBOX_USERS --env production
```

### Not covered yet

- Nothing catches up on notifications Apple gave up retrying (after about 3 days). Asking the App Store Server API for the subscription's status would, and needs an In-App Purchase key.
- Purchases that carry no `appAccountToken`, such as offer codes redeemed in the App Store app, can't be credited.

## Deploys

CI deploys every merge: `staging` goes to staging.onmyhop.com and `main` to onmyhop.com. It applies D1 migrations first, then deploys the Worker (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). To redeploy without a new merge, run the CI workflow manually on that branch.

Deploys need a Cloudflare API token (the "Edit Cloudflare Workers" template plus Account › D1 › Edit, limited to this account and the onmyhop.com zone). It's stored as the `CLOUDFLARE_API_TOKEN` secret on the `staging` and `production` GitHub environments. Each environment only accepts deploys from its own branch. The account ID is the `CLOUDFLARE_ACCOUNT_ID` repository variable.

Migrations run before the new Worker goes live, so each one must still work with the previous release.
