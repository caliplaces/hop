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

`OIDC_APP_REDIRECT` in `wrangler.jsonc` picks the callback per environment. Any other value, or none, turns app sign-in off rather than falling back to the scheme:

- `"https"`: `<APP_URL>/api/auth/app/callback`. Only Hop can catch it, because the app's `webcredentials` associated domains name this site, and the site lists the app in `/.well-known/apple-app-site-association`, which the Worker serves. If the page ever loads in a browser, it only says to go back to the app.
- `"scheme"`: the custom scheme `com.onmyhop.app:/auth/callback`, which another app could also claim. It's kept only while moving to https, and local development uses it.

A flow remembers its redirect URI, so changing the setting doesn't break a sign-in already under way, and only this environment's own redirects are accepted.

Moving off the custom scheme, which any app could claim:

1. Register both https callbacks on the Native app.
2. Switch staging, then production, to `"https"`. Do production before the first App Store build: older builds only know the scheme and can't sign in once it's gone.
3. Give local development its own Native app with the scheme, since the https callback may not work in the simulator. Then remove the scheme from the shared app, so nothing can sign in as Hop through it.
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

| Email           | When                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome         | An athlete claims their handle                                                                                                                              |
| New clips       | Clips arrived and uploads have been quiet for 10 minutes, or an hour after the first one (`src/notify.ts`)                                                  |
| Report          | A clip or page is reported: to `REPORTS_EMAIL`, with the IDs needed to look at it                                                                           |
| Clips expiring  | A week before free-plan clips go, and usually the day before (`src/expiry.ts`), whatever the new-clips setting                                              |
| Account deleted | An athlete deletes their account: what went, that the handle stays reserved, what to do if it wasn't them, and that Hop+ is billed by Apple until cancelled |

The new-clips digest runs every 5 minutes. A clip counts as announced once `files.notified_at` is set; each run claims an athlete's unannounced clips in one statement before sending, and hands them back if the send fails. Athletes turn it off in account settings, from the unsubscribe link in each email (a page that asks first), or with their mail app's one-click unsubscribe (`List-Unsubscribe`, RFC 8058).

The same digest goes to the athlete's phones as a notification ("2 new clips from Street Kings Prague", "Coach Peter and Lea sent you clips."), once per batch: when it's claimed, never again on an email retry, and only one run can claim it. It goes whether or not they get the email, unless they turned `users.push_new_clips` off (in the app's Account). Clips the athlete watched arrive on Event mode's Live Activity (in that event, since it started) are left out, and nothing is pushed if that's all of them. Notifications of one event are grouped on the phone (`thread-id`), and carry `{ hop: "clips", hopId }` for the app to open it.

### Bounces and spam complaints

Resend's webhook tells Hop which emails never arrived, and which addresses not to email again (`src/email/webhook.ts`, `src/email/suppressions.ts`):

- `POST /api/email/resend-webhook` receives Resend's events. Each must carry a valid Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`: an HMAC-SHA256 of `${id}.${timestamp}.${body}` with the endpoint's signing secret, at most five minutes old either way). The HMAC is computed once and compared in constant time with at most the first five signatures in the header. Without `RESEND_WEBHOOK_SECRET` the endpoint isn't there (404).
- Only this environment's emails count. Every email Hop sends is tagged `env` with its `ENVIRONMENT`, and an event must carry the same tag, from `EMAIL_FROM`'s domain. Staging and production share the Resend account and both hear of every email, and the account sends for other products too.
- **An email that never arrived:** any bounce (`email.bounced`, permanent or temporary), a failure to send (`email.failed`), or Resend refusing to send (`email.suppressed`). Free-plan expiry only counts a notice that reached the athlete. Each notice keeps Resend's ID for the email that gave it (`expiry_notices.email_id`), so the event's `email_id` finds it, whatever the athlete's address is by then. That notice is let go and its clips go back unclaimed. They stay, and a fresh notice is claimed the next day. The event can come back before Hop has written down which email gave the notice, so the email's ID is also kept for a month (`undelivered_emails`), and a notice only counts if its email isn't there. That is checked in the same statement that counts it. An answer from Resend without an ID isn't counted either: the email is tried again, under the same key.
- **An address not to email again:** a permanent bounce (`bounce.type` `Permanent`), a spam complaint (`email.complained`), or `email.suppressed` (the address is on Resend's account-wide suppression list). It goes into `email_suppressions`, keyed by `normalizeAddress`: spaces trimmed and A–Z lowercased, exactly what SQLite's `lower(trim())` does, so SQL matching an account's address agrees with it. A spam complaint means the email did arrive: a notice it gave still counts.
- `sendEmail` checks every email against the list, so nothing goes to a listed address: not the welcome, the new-clips digest, the launch email, clips expiring, or account deleted. The digest and the launch email treat such an address as handled, like an opt-out. Only the report emails to `REPORTS_EMAIL` go regardless: a lost report is worse than a bounce.
- An athlete whose address is listed is never sent a notice, so their free clips stay past 30 days, within the free plan's storage. A notice waiting to be sent is let go, unsent and unpushed.
- An entry is kept a year (the hourly cleanup), and goes when its account is deleted: if the address was verified and no other live account has it. A listed address gets no account deleted email, which would only bounce and put it back on the list. An athlete whose Caliplaces address changes is emailed again at the new one. To email a listed address sooner, delete its row (and remove it from Resend's suppression list in its dashboard).

Setup, per environment, in Resend's dashboard (Webhooks › Add endpoint):

1. Endpoint URL: `https://onmyhop.com/api/email/resend-webhook` for production, `https://staging.onmyhop.com/api/email/resend-webhook` for staging. Staging only lets the team's IPs in, so its firewall needs an exception for that one path, as for Stripe's webhook.
2. Events: `email.bounced`, `email.failed`, `email.complained`, `email.suppressed`.
3. The endpoint's signing secret (`whsec_…`) is the environment's `RESEND_WEBHOOK_SECRET`:

```sh
wrangler secret put RESEND_WEBHOOK_SECRET --env production
wrangler secret put RESEND_WEBHOOK_SECRET --env staging
```

Emails sent before the `env` tag existed carry none, and their events are ignored.

While `pnpm dev` runs, open [localhost:5173/email-lab.html](http://localhost:5173/email-lab.html) to see every email with sample data, in each colour, at phone and desktop width, and in dark mode. Without `RESEND_API_KEY` in `.dev.vars`, emails are printed to the wrangler console instead of sent.

The Bobble images in emails are rendered per colour by `pnpm --filter @hop/web mascot:assets email` into `apps/web/public/email/`.

## Launch waitlist

Until launch (December 1, 2026), the landing page collects a waitlist. `POST /api/waitlist` takes `{ email, turnstileToken }` (`joinWaitlistSchema` in `packages/shared/src/waitlist.ts`) and stores the email in the `waitlist` table, lowercased and once (`src/routes/waitlist.ts`).

- It always answers `{ ok: true }`, whether or not the email was already on the list, so nobody can probe it for addresses.
- Turnstile is required, minted with the `waitlist` action, so a token from the upload form doesn't count. Locally, a missing token is allowed.
- Each IP gets 10 tries a minute (`WAITLIST_LIMITER`).

The list is only for the launch email (`src/launch.ts`, template `src/email/launch.tsx`):

- **When:** from `LAUNCH_AT` in `packages/shared/src/launch.ts` (midnight CET, December 1), on the five-minute cron.
- **How:** one email at a time, for up to three and a half minutes a run. `sendEmail` spaces every send to Resend, so the launch email and the digest stay under its rate limit together. Each address is claimed first and has a fixed idempotency key, so neither overlapping runs nor retries email anyone twice.
- **Failures:** a failed send is tried again five minutes later, five times at most, and never after 23 hours, before Resend could forget the key. A rate limit ends the run. If Resend already had a different email under the key (the App Store link was added meanwhile), the earlier one went out, and it counts as sent.
- **Afterwards:** `notified_at` marks who has had it. The hourly cleanup deletes each address a day later, as the email tells them.
- **The app:** set `APP_STORE_URL` once the app is out, and the email links it too.
- **Trying it out:** the email lab (`/email-lab.html` while `pnpm dev` runs) shows the email. To send it for real on staging before launch, set `LAUNCH_AT` there to an ISO time: everyone on staging's waitlist gets it.

To read the list:

```sh
wrangler d1 execute hop-production --remote --env production \
  --command "select email, created_at, notified_at from waitlist order by created_at"
```

## Live Activity pushes

The iPhone app's Event mode shows a Live Activity counting the clips that come in. The API keeps it counting with the phone locked, by pushing an update through Apple's push service (APNs) each time an upload completes (`src/live.ts`).

- The app registers the Live Activity's push token with `PUT /api/me/live-activities/:token`. It registers again when Apple rotates the token or the app relaunches, and removes the token with `DELETE` when Event mode ends. Registrations expire after 12 hours, like the Live Activity, and each athlete keeps at most five.
- Each update carries the clips that finished uploading since Event mode started, and who sent the latest. The first clip, and then at most one every 5 minutes, also lights up the screen, silently. Tokens Apple no longer accepts are forgotten.
- Each environment has its own APNs key, restricted to the `com.onmyhop.app` topic: a sandbox key for staging (debug builds) and a production key for production (TestFlight and App Store builds). The key is the `APNS_KEY` secret; its ID and environment are `APNS_KEY_ID` and `APNS_ENVIRONMENT` in `wrangler.jsonc`. Without the secret, nothing is pushed.
- `wrangler dev` can't reach APNs, so try pushes on staging. Locally, `POST /api/dev/hops/:hopId/arrivals` lands a fake clip in an event, for trying Event mode without uploading anything.

## Profiles

What others see of an athlete, on their upload page and in the app, is Hop's own profile, kept apart from their Caliplaces account:

- **Name.** `users.display_name`, set with `PATCH /api/me { displayName }`. `users.name` is their Caliplaces account's, refreshed at every sign-in, and stands in until they set one; `displayName: null` goes back to it. Both follow the same rules (`displayNameSchema` in `packages/shared/src/api.ts`), and a Caliplaces name that breaks them is dropped, so their @handle shows instead:
  - NFC-normalised and trimmed, 1 to 50 characters, with at least one letter or number;
  - no control or invisible characters (bidi overrides, zero-width and other default-ignorable ones), except those that build an emoji;
  - no stacks of combining marks, no leading @ (it would pass for a handle) and no check marks (they'd pass for a badge).
- **Photo.** `PUT /api/me/avatar` with a JPEG of at most 512 KiB. The server rebuilds it from only what's needed to show it (`src/lib/jpeg.ts`): EXIF (and its GPS location), XMP, comments and anything after the image are dropped. It refuses anything over 2048 px on a side, CMYK, lossless or arithmetic-coded, or malformed. The photo is stored in R2 under a new random name (`avatars/<random>.jpg`) and served publicly at `/api/avatars/<random>.jpg`, cached for a week. `DELETE /api/me/avatar` removes it. Replacing a photo swaps the key in one transaction, then deletes the old photo, best effort: the hourly cleanup also sweeps photos no account points to, once they're an hour old.
- **Hop+ mark.** `hopPlus` on `Me` and on a public page's owner is true while they have Hop+, and their page shows a Hop+ mark. It's deliberately not a "verified" check: paying doesn't prove who someone is. It does tell anyone who knows a handle whether that person subscribes, which the privacy policy should say.
- **First look.** `profileReviewed` is false until the app has shown them their profile once (`PATCH /api/me { profileReviewed: true }`).
- **Limits.** Each account gets 20 profile changes a minute (`PROFILE_LIMITER`).

To take down a name or photo someone reports:

```sh
wrangler d1 execute hop-production --remote --env production \
  --command "update users set display_name = null, avatar_key = null where handle = 'their-handle'"
```

The photo itself goes with the next hourly cleanup, and caches drop it within a week.

## Deleting an account

`DELETE /api/me` deletes the signed-in account, from the app (Account → Delete Account, which App Review requires) or the website. In one transaction (`src/lib/accounts.ts`):

- **Everything that identifies them goes:**
  - email, both names and the photo (deleted from R2 at once);
  - the App Store account token, which Stripe customer was theirs, subscriptions and Live Activities;
  - every session, so they're signed out everywhere;
  - a verified address on the launch waitlist.

  Their Caliplaces login is let go too (`oidc_sub` becomes `deleted:<id>`), so signing in with it again starts a new, empty account.

- **Their hops close and their clips are marked for removal.** The hourly cleanup removes the clips from R2 in batches, then drops each hop once it's empty.
- **Clips they sent other athletes stay with those athletes,** no longer tied to an account. They keep the sender's @handle (which stays reserved), but not a name: without a handle, that was their real one.
- **The row stays as a tombstone (`users.deleted_at`).** It keeps the id, the handle, the colour and timestamps, nothing that identifies them. The page 404s, and the handle can't be claimed, theirs included: whoever took it would receive clips people send to the old link or QR code.

A deleted account's sessions are refused, even one a sign-in under way created just after. A request already running when they delete could still write to the tombstone (a name, a photo, a clip sent to someone, a Live Activity). So for a week after a deletion, every cleanup run erases the account again. A handle claim only lands on an account with no handle that isn't deleted. Uploads re-check that the hop is still open when they reserve their place. Each of these cleanup steps runs on its own, so one failing doesn't stop the rest.

Deleting the account doesn't cancel Hop+ from the App Store, which Apple bills until it's cancelled in their Apple Account. The app says so before they delete, and so does the confirmation email. The purchase carries the deleted account's token, so restoring it on a new account fails with `deleted_account`, which tells them to cancel it and subscribe again.

Hop+ from the website is cancelled at once, in Stripe, before anything else (see "Hop+ on the website"). If Stripe can't be reached, the deletion answers `503 billing_unavailable` and the account stays, rather than be billed after it's gone.

## Reports and blocks

Anyone with an athlete's link can send them clips, and anyone can open their page. App Review requires a way to report content and to block whoever sends it (Guideline 1.2).

- **Reporting a clip.** `POST /api/me/files/:fileId/report { reason, note? }`, by the athlete it was sent to, from the app. The report keeps the clip's sender, note and file name.
  - The clip is held for 30 days from its first report (`files.held_until`); reporting it again doesn't stretch that. Deleting it in that time only hides it (status `held`), and so does a block or deleting the account. The team can still look, and the hourly cleanup removes it once the hold is over.
  - Deleting checks the hold and claims the clip in one statement, and a report only holds a clip that isn't already going. So a clip is either held or deleted, never both.
- **Reporting a page.** `POST /api/h/:handle/report { reason, note?, turnstileToken }`, by anyone, from the upload page. It's behind Turnstile and a limit per IP (per /64 for IPv6). The same visitor reporting the same page again within a day changes nothing.
- **Blocking a sender.** `POST /api/me/files/:fileId/block` blocks whoever sent that clip.
  - The block covers every way they're known: their account if they were signed in, and each random key their browsers keep (`block_keys`). That includes every browser they sent this athlete clips from while signed in, so signing out on any of them doesn't help. That key is the `hop_sender` cookie, set by the upload routes, limited to `/api/hops` and renewed for a year with each use. Only its hash is stored, on each clip (`files.sender_key`) and block. The upload pass carries it too, so dropping the cookie doesn't make each upload a new sender. A block also ends the sender's pass.
  - Blocking by IP address would also block everyone else on the same network, such as a whole crowd on an event's Wi-Fi. Someone who clears their cookies and solves Turnstile again gets past a block, which is why reports exist for anything worse.
  - Their clips leave the athlete's inbox at once, uploads under way included, and the team hears about the block. The reply lists the clips that went (`removedIds`), so the app can drop them before it reloads.
  - An athlete is never blocked from their own Hop while signed in. Clips from before sender keys can't be blocked (422), only reported.
- **Managing blocks.** `GET /api/me/blocks` lists them, and `DELETE /api/me/blocks/:id` unblocks. Clips that went with a block don't come back.
- **When a block applies.** A blocked sender hears "You can't send clips to this Hop." when they ask for an upload pass. The upload checks again, in the same statement that reserves its place.
- **How the team hears.** Each report and block is kept in `reports` for a year. Every five minutes, the email job sends the new ones to `REPORTS_EMAIL` (hello@onmyhop.com) in one email (`src/reports.ts`). A flood of reports is at most one email a run.
  - Each email is a batch claimed once (`reports.email_batch`), and the batch is its idempotency key.
  - A send that fails, or whose reply is lost, goes again next run as the very same batch, so it can't repeat earlier reports. Reports that arrived since wait for the next batch. Someone should look within a day.
- **Limits.** Reports and blocks are limited by `REPORT_LIMITER`.
- **Deleted accounts.** Their blocks go, and their name is dropped from reports they made. Where they were the sender, a name is dropped from reports and others' blocks, and an @handle stays. Reports about them stay as the record.

To look at a reported clip, find its key with the clip ID from the email, then fetch it:

```sh
wrangler d1 execute hop-production --remote --env production \
  --command "select r2_key, status, held_until from files where id = 'fil_…'"
wrangler r2 object get hop-production/<r2_key> --remote --file clip
```

To keep a clip longer, for example while working with the authorities, push its hold back:

```sh
wrangler d1 execute hop-production --remote --env production \
  --command "update files set held_until = <ms since 1970> where id = 'fil_…'"
```

To take down a reported name or photo, see Profiles above.

## Free-plan expiry

Free-plan clips are kept for 30 days (`PLANS.free.retentionDays`), then removed for good, from R2 too (`src/expiry.ts`). No clip goes without a notice emailed to its athlete's verified address:

- **The notice.** When a clip is 23 days old, its athlete is told a week ahead (`EXPIRY_NOTICE_DAYS`): "12 clips leave your inbox on Monday 23 November".
  - It names a calendar day, the same everywhere. The clips stay until that day has ended in every time zone (12:00 UTC the day after), so at least seven and a half days.
  - It's an email to a verified address, whatever their new-clips setting, since it's about losing clips. It's also pushed, once, to each of their phones that turned on notifications (`apns-collapse-id`, so the reminder replaces it).
  - It counts only once Resend accepted the email. A push never counts on its own: Apple accepts pushes that a phone has silenced in Settings, or that sit on a phone that's off. Athletes without a verified address are never noticed, so their clips stay.
  - The plan (`GET /api/me/plan`) shows noticed clips as `expiring: { clips, on, at }`, for the app's banner.
  - Not handled yet: an address that hard-bounces after Resend accepted the email. That needs Resend's `email.bounced` webhook to undo the notice.
- **The reminder,** two days to one hour before they go: "Last call: 12 clips leave your inbox on Monday 23 November". One notice at a time, soonest first. Best effort. Both suggest saving the clips from the inbox, or getting Hop+.
- **Removal.** A clip goes at its notice's time (`files.expiry_goes_at`), once 30 days old. The hourly cleanup marks and removes them in the same run. At that point it checks again that the notice was given and not let go, and that the athlete hasn't had Hop+ in the last 30 days. A clip held for a report is only hidden until its hold ends (see Reports and blocks).
- **Hop+.** While the athlete has Hop+, expiry stops and their notices are cleared. For 30 days after it ends (`LAPSE_MARGIN_MS`), nothing is noticed or removed, so a renewal Apple hasn't reported yet can't cost a subscriber their clips. After that, old clips get a fresh notice and week like any others.
- **How often.** Each athlete gets at most one notice a day (counted from when the last one got through) and at most one reminder a day, each covering every clip due one. They run with the five-minute email jobs: at most 25 athletes each for claiming, sending and reminding, and no new sends after three minutes.
- **Retries.** A notice is a row in `expiry_notices`, one per athlete and claim (`batch`), which its clips point to (`files.expiry_notice_batch`). It keeps what it says from the claim, so every try sends the same email under the same idempotency key. Tries back off from 5 minutes to an hour. One not through after six hours is let go: its clips stay, and are claimed afresh the next day.
- **Overlapping runs.** Each change to a notice (claimed, given, let go, reminded) applies only to the state it changes from, in the same transaction as its clips. Two runs can't undo each other, or claim an athlete twice in a day. The tests force each overlap.
- **Cost.** The claim reads every athlete once a run. Every query on clips goes through `files_unnoticed_idx`, `files_notice_idx` or `files_goes_idx`, which `expiry.test.ts` checks with `EXPLAIN QUERY PLAN`, with and without production-like statistics.
- **Housekeeping.** The cleanup forgets notices whose clips are all gone, once two days old.

The app registers its push token with `PUT /api/me/devices/:token { environment }` (rate limited, at most five phones per athlete, newest kept) and removes it on sign-out (`DELETE /api/me/devices/:token`). Each install has one token, so signing in to another account moves it. The app refreshes its token every launch, and one not refreshed in 90 days is forgotten. Notifications use the same APNs key as Live Activities, as `alert` pushes to the app's own topic. Only Apple's 410 makes the API forget a token: a 400 such as `DeviceTokenNotForTopic` is likelier this server's setup than the phone.

## Stats page

`onmyhop.com/admin` shows Hop's numbers to Hop's team: athletes (new and active), people who sent clips, events, clips, storage by plan, Hop+ subscribers, the waitlist, and the last 30 days day by day (`GET /api/admin/stats`, `src/stats.ts`). It's counts and sums over what the API stores anyway, read on demand: nothing new is collected, and nothing is about anyone in particular.

Only accounts listed in the `ADMIN_USER_IDS` secret (comma-separated `usr_…` IDs) can see it, once signed in on the website. Everyone else, signed in or not, gets the same 404 as any unknown page. Set it per environment:

```sh
pnpm --filter @hop/api exec wrangler secret put ADMIN_USER_IDS --env production
```

"Active" athletes used the app or the website in the window, as a lower bound. App sessions renew at most daily, so app use shows to the day until a session nears its one-year limit (renewals stop at day 275 of it). Website sessions renew only in their last week. Periods are rolling: the last 24 hours, 7 days and 30 days. "People who sent clips" are counted by account when signed in, otherwise by browser.

## Hop+ subscriptions

Athletes subscribe to Hop+ in the iPhone app, through the App Store, or on the website, through Stripe (see "Hop+ on the website" below). The plans are in `packages/shared/src/limits.ts`:

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

Upload quota checks use the plan at the moment of the upload (`src/lib/plans.ts`). Retention is "Free-plan expiry" below.

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

## Hop+ on the website

The website sells Hop+ through Stripe Checkout, and Stripe's customer portal handles everything after: payment method, invoices, switching plans, cancelling (`src/lib/stripe.ts`, `src/routes/stripe.ts`). Stripe Tax isn't on: the price set on the product is what's charged.

- `GET /api/billing/web/prices`: the Hop+ product's active monthly and yearly prices (the newest of each), cached for five minutes. None where Stripe isn't set up, webhook included, and the website then doesn't offer Hop+: without the webhook, renewals would never reach Hop.
- `POST /api/billing/web/checkout` `{ priceId }`: a Checkout page, with a box to tick that agrees to Hop's terms and asks for Hop+ to start right away. It is for cards only (Apple Pay and Google Pay among them): bank debits mark a subscription active before the money arrives, and can fail or be reversed weeks later. The athlete gets a Stripe customer the first time (`users.stripe_customer_id`). It catches up with Stripe first, then:
  - refuses with `409 already_plus` with Hop+ from anywhere, so a checkout paid moments ago counts;
  - refuses with `409 payment_due` while a subscription is still billing but behind, since fixing the card in the portal brings Hop+ back;
  - cancels a subscription still waiting for its first payment;
  - expires any checkout left open, so only the newest can be paid. One checkout opens at a time per account (`users.stripe_checkout_at`, a two-minute lock), or two at once could each leave theirs open (`409 checkout_opening`). A checkout that has run so long that its lock may run out before Stripe answers doesn't open one. Deleting the account takes the same lock, then reads the customer, so a checkout can't make one unseen.
- `POST /api/billing/web/portal`: a portal page, for athletes with a customer, with Hop's own portal configuration (`STRIPE_PORTAL_CONFIGURATION`): the account's default is shared with its other products and could let a subscription switch to one of them.
- `POST /api/billing/web/sync`: reads their subscriptions from Stripe now, ended ones too, and returns the plan, for coming back from Checkout or the portal before the webhook lands. Stored Hop+ that Stripe didn't list (its customer was deleted) is read one by one.
- `POST /api/stripe/webhook`: Stripe's events.

Checkout, the portal and syncing are rate limited per account (`BILLING_LIMITER`), since Stripe's own limit is shared with the account's other products. A customer Stripe no longer has (deleted in its dashboard, which cancels its subscriptions) is forgotten, and the next checkout makes a new one.

How it's kept right:

- **Only Stripe's word.** A webhook must carry a valid `Stripe-Signature` (HMAC-SHA256 with the endpoint's signing secret, at most five minutes old). Even then it only names a subscription, which is fetched from Stripe and stored as it is now. Data fetched earlier never overwrites data fetched later, so retried and out-of-order events can't roll it back.
- **Only Hop+.** The Stripe account sells other products: only subscriptions whose every item is `STRIPE_PRODUCT_ID` count, and only for a customer Hop made for a live account. One moved to another product, or one Stripe no longer has, ends its Hop+ there and then.
- **Test and live mode.** Live mode only in production; test mode locally and on staging. An event or subscription in the other mode is refused.
- **What it gives.** Stored with the App Store's in `subscriptions`, as `provider = 'stripe'`, the subscription ID as its key, and `hop_plus` or `hop_plus_annual` for its period. Paid up: Hop+ to the period's end. Past due, while Stripe retries the renewal: Hop+ carries on as a billing grace period, for up to 16 days. Cancelled: until it ended. Unpaid or paused: it ended when the unpaid period began. Never paid (incomplete): not stored.
- **Deleted accounts.** Deleting an account cancels every subscription its Stripe customer has (Hop made it, and nothing else uses it) and expires its open checkouts first. A checkout paid after all (Stripe can't expire one being paid) makes a subscription whose metadata names the deleted account: the webhook cancels it. Stripe keeps the customer and its invoices, as accounting law requires; Hop forgets which one it was.

Setup, per environment (test mode for staging, live mode for production):

1. The product: `STRIPE_PRODUCT_ID` in `wrangler.jsonc`. Give it a monthly price and, if wanted, a yearly one, both recurring every 1 month or 1 year.
2. An API key. A restricted key needs write access to Customers, Checkout Sessions, Subscriptions and the Customer portal, and read access to Prices.
3. A webhook endpoint at `https://onmyhop.com/api/stripe/webhook` (or staging's), with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid` and `invoice.payment_failed`. Staging only lets the team's IPs in, so its firewall needs an exception for that one path.
4. Hop's own customer portal configuration, as `STRIPE_PORTAL_CONFIGURATION` in `wrangler.jsonc`: cancelling at the end of the period, updating the payment method and email, invoices, and no plan switching (`features[subscription_update][enabled]=false`; to let people switch between monthly and yearly, enable it with only Hop+'s two prices). Make it with `POST /v1/billing_portal/configurations`, as staging's was, not by editing the account's default, which the other products share. Under Settings › Business › Customer emails, turn on receipts.
5. Refunds and disputes don't end Hop+ on their own: when refunding, cancel the subscription too, at once. Then Hop+ ends. An EU withdrawal within 14 days (see /terms) refunds only the days not used: Checkout has the athlete ask for Hop+ to start right away (Stripe records it on the session, `consent.terms_of_service`). Refund that part of the payment, then cancel.
6. Checkout's box to tick (`consent_collection`) needs a terms of service URL under Settings › Public details. The box's own text links Hop's terms, whatever URL is set there, since the account is shared.

```sh
wrangler secret put STRIPE_SECRET_KEY --env staging       # sk_test_… or rk_test_…
wrangler secret put STRIPE_WEBHOOK_SECRET --env staging   # whsec_… from the endpoint
```

Locally, run `stripe listen --forward-to localhost:8787/api/stripe/webhook` and put the `whsec_…` it prints in `.dev.vars`.

Not covered yet: two checkouts paid at the same moment. The checkout lock and expiring open checkouts make it unlikely: Stripe can't expire a checkout while it's being paid. If it happens, the athlete has two subscriptions, and one needs cancelling and refunding by hand.

## Deploys

CI deploys every merge: `staging` goes to staging.onmyhop.com and `main` to onmyhop.com. It applies D1 migrations first, then deploys the Worker (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). To redeploy without a new merge, run the CI workflow manually on that branch.

Deploys need a Cloudflare API token (the "Edit Cloudflare Workers" template plus Account › D1 › Edit, limited to this account and the onmyhop.com zone). It's stored as the `CLOUDFLARE_API_TOKEN` secret on the `staging` and `production` GitHub environments. Each environment only accepts deploys from its own branch. The account ID is the `CLOUDFLARE_ACCOUNT_ID` repository variable.

Migrations run before the new Worker goes live, so each one must still work with the previous release.
