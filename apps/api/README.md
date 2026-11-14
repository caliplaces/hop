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

To sign in locally, register a **web** app at [developer.caliplaces.com/apps](https://developer.caliplaces.com/apps) with redirect URI `http://localhost:5173/api/auth/callback`.

## How uploads work

1. The contributor page solves Turnstile once. `POST /api/hops/:hopId/pass` returns a signed pass that's valid for 2 hours.
2. `POST /api/hops/:hopId/uploads` checks the Hop, quota and type, starts an R2 multipart upload, and returns a `fileId` plus a per-file upload token.
3. `POST /api/uploads/:fileId/parts` returns presigned `UploadPart` URLs. The browser PUTs 10 MiB parts straight to R2.
4. `POST /api/uploads/:fileId/complete` completes the upload, checks the final size, and sniffs the first bytes to make sure it's really a video or photo.
5. The browser grabs a frame and uploads a small JPEG thumbnail with `PUT /api/uploads/:fileId/thumbnail`.

An hourly cron aborts uploads still pending after 3 days and deletes expired sessions.

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

# Schema, then deploy
pnpm --filter @hop/api db:migrate:staging
pnpm build && pnpm --filter @hop/api exec wrangler deploy --env staging
```

You also need to:

- Fill in `OIDC_CLIENT_ID` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
- Register `https://staging.onmyhop.com/api/auth/callback` on the Caliplaces developer app.
- Verify the app's domain with the DNS TXT record, which removes the "unverified app" warning and the 100-user cap.
