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
wrangler r2 bucket lifecycle add hop-staging abort-multipart --abort-multipart-days 2
wrangler d1 create hop-staging        # put the database_id into wrangler.jsonc

# Secrets
wrangler secret put OIDC_CLIENT_SECRET --env staging
wrangler secret put SESSION_SECRET --env staging          # openssl rand -base64 32
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put R2_ACCOUNT_ID --env staging
wrangler secret put R2_ACCESS_KEY_ID --env staging        # R2 API token, Object Read & Write, this bucket only
wrangler secret put R2_SECRET_ACCESS_KEY --env staging

# Schema, then deploy
pnpm --filter @hop/api db:migrate:staging
pnpm build && pnpm --filter @hop/api exec wrangler deploy --env staging
```

You also need to:

- Fill in `OIDC_CLIENT_ID` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
- Register `https://staging.onmyhop.com/api/auth/callback` on the Caliplaces developer app.
- Verify the app's domain with the DNS TXT record, which removes the "unverified app" warning and the 100-user cap.
