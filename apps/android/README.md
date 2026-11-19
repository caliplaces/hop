# Hop for Android

The native Android app, built with Kotlin, Jetpack Compose and Material 3
Expressive. It follows Android's own patterns rather than mirroring the iPhone
app. The athlete's colour grows a full Material You colour scheme, in light and
dark, and Material's expressive shapes and motion run throughout.

So far it has:

- the welcome screen, Sign in with Caliplaces (in an Auth Tab), claiming a Hop
  link and picking a colour, and "This is you";
- the inbox: event covers, each event's clips, and a viewer that plays them,
  with save to the gallery, share, delete, report and block;
- My Hop: the Hop pass with its holographic foil and QR code, the code full
  screen, and the pass as a story image;
- Event mode: the QR code on stage, the clips counted as they land, and an
  ongoing notification (a Live Update on Android 16);
- the account: profile, plan and storage, new-clip emails, blocked senders,
  and deleting the account.

- the QR code from anywhere: a home screen widget, a Quick Settings tile and
  a "Show my QR code" app shortcut, each opening Event mode's stage while it
  runs;
- push notifications: new clips (grouped by event), free-plan clips about to
  leave, and Event mode's count with the app closed.

Hop+ comes next, through Google Play.

## Running it

You'll need Android Studio (or JDK 21 and the Android SDK) with the Android 17
SDK platform (API 37).

1. Open `apps/android` in Android Studio.
2. Pick an emulator or a phone and press Run.

From the command line:

```sh
cd apps/android
./gradlew :app:installDebug
```

Debug builds talk to staging.onmyhop.com and sign in with a real Caliplaces
account. To use the API running on this computer instead, set `hop.apiUrl` in
`~/.gradle/gradle.properties`, or pass it to Gradle:

```sh
./gradlew :app:installDebug -Phop.apiUrl=http://10.0.2.2:8787   # the emulator's address for this computer
```

On a phone connected over USB, run `adb reverse tcp:8787 tcp:8787` and use
`http://127.0.0.1:8787`. Debug builds allow plain http to those local
addresses only; release builds always use https://onmyhop.com.

## Push notifications

Notifications come through Firebase Cloud Messaging, as data messages the
app turns into its own notifications (see "Android pushes" in
`apps/api/README.md`). Firebase starts from `HopApplication` with each
build's settings, not from a `google-services.json`, and nothing else of
Firebase is in the app: no Analytics, and no token until someone signs in.

Debug and release builds share one Firebase project (the API's staging and
production both push through it). Its settings go in
`~/.gradle/gradle.properties`, never in the repository:

```properties
hop.firebase.appId=…
hop.firebase.projectId=…
hop.firebase.apiKey=…
hop.firebase.senderId=…
```

They're in the Firebase console, under Project settings › Your apps. A
build without them has no push notifications (and no messaging service),
and everything else works: Event mode counts while the app is open.

- **Asking.** Hop asks from a card in the inbox, or from the account's
  "New clips" settings, never at launch. Once someone has said no for good,
  the button opens Hop's notification settings instead.
- **Registering.** While someone is signed in and notifications are
  allowed, the app sends its FCM token to the API once each launch, and
  again whenever FCM changes it. While Event mode runs, the API has it for
  the event's count too.
- **Signing out.** Hop's notifications leave the phone at once, and nothing
  more shows while nobody is signed in. The app takes the token back from
  the API, then deletes it at FCM, which then refuses pushes to it: if the
  API never heard of the sign-out (offline, or the session had already
  ended), it forgets the token at its next push. A sign-out the app was
  closed in the middle of, or an FCM deletion that failed offline, is
  finished at the next launch. A message also says whom it's for, as a hash
  of the account and the token, and the app drops any that isn't for
  whoever is signed in.
- **Only data messages.** The API never sends FCM's own notification
  messages, which Firebase would show without the app checking whom they're
  for. Nobody should send any from the Firebase console either. The app
  shows its notifications itself (notification delegation is off).
- **The API key.** Each build carries the Firebase project's API key, as
  every Firebase app does. In Google Cloud, restrict it to the Android app
  `com.onmyhop.app` with the certificates it's signed with (Play's, and the
  debug ones of whoever tests it), and to the Firebase Installations and FCM
  Registration APIs.
- **Channels.** New clips, Clips leaving soon, and Event mode, so each can be
  turned off on its own. On a lock screen that hides notifications' content,
  new clips show only "New clips".

## Signing in

Sign-in runs as on the iPhone app. Hop's API starts the flow
(`POST /api/auth/app/start`), the app shows Caliplaces' page in an
[Auth Tab](https://developer.chrome.com/docs/android/custom-tabs/guide-auth-tab),
and it hands the redirect back to the API (`POST /api/auth/app/session`). The
API trades the code for a Hop session. The app only ever holds that session
token, encrypted with an AES key kept in the Android Keystore. Backups and
device transfers are off for the whole app.

The API says where the redirect goes, and the app accepts only Hop's own:

- the https callback on the API's own host, which production uses. Chrome
  hands it only to the app the site lists in its Digital Asset Links
  (`/.well-known/assetlinks.json`, which the API serves from
  `ANDROID_CERT_FINGERPRINTS`: see Releasing);
- in debug builds only, the custom scheme `com.onmyhop.app:/auth/callback`,
  which staging still uses. Any app can claim a scheme and pose as Hop with
  it, so release builds refuse it, and only the debug manifest registers it.

The redirect comes back through the Auth Tab's result. In browsers without
Auth Tabs, it comes through `SignInCallbackActivity`, which catches the https
callback as a verified app link (once the site's Digital Asset Links list the
app) and, in debug builds, the custom scheme. Either way, it only finishes a
sign-in already under way, and only if it's exactly that flow's callback with
that flow's `state`.

## Releasing

Release builds go to Google Play as an Android App Bundle, signed with Hop's
upload key. Play checks that key, then signs what it delivers with its own
app signing key. The upload key's settings go in `~/.gradle/gradle.properties`,
never in the repository, and the key file is kept with the team's other keys:

```properties
hop.upload.storeFile=/path/to/hop-upload.jks
hop.upload.storePassword=…
hop.upload.keyAlias=upload
hop.upload.keyPassword=…
```

Without them, release builds are unsigned (as in CI). Build from main, which
is what production runs, with a fresh version code: like the iPhone app's
build numbers, `<yyyymmdd><n>`.

```sh
./gradlew :app:bundleRelease -Phop.versionCode=202611181
# app/build/outputs/bundle/release/app-release.aab
```

Sign-in on production needs the site's Digital Asset Links to list Google
Play's app signing key: its SHA-256, from Play Console › Test and release ›
App integrity, is production's `ANDROID_CERT_FINGERPRINTS` in
`apps/api/wrangler.jsonc`. Only Play's: a build signed with anything else,
the upload key included, can't sign in on production, so a stolen upload key
can't sign a lookalike that catches sign-ins (and Play can reset it). Try
release builds through Play's internal testing, which Play signs with its key.

## Tests

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug
```

`PaletteTest` and `HandleRulesTest` check the app against
`packages/shared/src/colors.ts` and `handles.ts`, so run the tests from a full
checkout of the repository. CI runs them, lint, and the debug and release
builds whenever the app changes (`.github/workflows/android.yml`).

## What's where

| Folder (under `app/src/main/kotlin/com/onmyhop/app`) | What's inside                                       |
| ---------------------------------------------------- | --------------------------------------------------- |
| `.`                                                  | The app's entry point and its signed-in/out stages  |
| `auth`                                               | The session, signing in, and Keystore token storage |
| `core`                                               | The API client and the API's types                  |
| `design`                                             | The theme, the palette and shared components        |
| `feature/welcome`                                    | The welcome screen                                  |
| `feature/claim`                                      | Claiming a handle and picking a colour              |
| `feature/profile`                                    | "This is you": name and photo                       |
| `feature/home`                                       | The signed-in tabs and navigation                   |
| `feature/inbox`, `feature/myhop`, `feature/account`  | The tabs and the account screen                     |
| `feature/event`                                      | Event mode: its stage, setup and notification       |
| `push`                                               | Push notifications: FCM, showing them, asking       |
| `widget`                                             | The home screen widget and the Quick Settings tile  |

Icons are [Material Symbols](https://fonts.google.com/icons) (Rounded), added
as vector drawables, so the app needs no icon library:

```sh
scripts/material-symbol.sh qr_code_2 share       # outlined
FILL=1 scripts/material-symbol.sh check_circle   # filled
```

Bobble, in every athlete colour, and the launcher icon's layers (with a
monochrome layer for themed icons) are rendered from the website's 3D mascot:

```sh
pnpm --filter @hop/web mascot:assets android
```

The app is `com.onmyhop.app`, like the iPhone app, so every environment uses
the same Caliplaces developer app (see "Signing in" in `apps/api/README.md`).
