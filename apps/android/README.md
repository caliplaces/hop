# Hop for Android

The native Android app, built with Kotlin, Jetpack Compose and Material 3
Expressive. It follows Android's own patterns rather than mirroring the iPhone
app. The athlete's colour grows a full Material You colour scheme, in light and
dark, and Material's expressive shapes and motion run throughout.

So far it has:

- the welcome screen;
- Sign in with Caliplaces, in an Auth Tab;
- claiming a Hop link and picking a colour;
- "This is you", with a profile photo from the system photo picker;
- the signed-in shell, with the Inbox and My Hop tabs and the account screen.

The clip grid, the viewer, the Hop pass with its QR code, Event mode,
notifications and Hop+ come next.

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

## Signing in

Sign-in runs as on the iPhone app. Hop's API starts the flow
(`POST /api/auth/app/start`), the app shows Caliplaces' page in an
[Auth Tab](https://developer.chrome.com/docs/android/custom-tabs/guide-auth-tab),
and it hands the redirect back to the API (`POST /api/auth/app/session`). The
API trades the code for a Hop session. The app only ever holds that session
token, encrypted with an AES key kept in the Android Keystore. Backups and
device transfers are off for the whole app.

The API says where the redirect goes, and the app accepts only Hop's own:

- the custom scheme `com.onmyhop.app:/auth/callback`, which staging still uses;
- the https callback on the API's own host, which production uses.

The custom scheme reaches the app through the Auth Tab's result, or, in
browsers without Auth Tabs, through `SignInCallbackActivity`. That activity only
hands the URL to a sign-in already under way, and only if it's that flow's
callback. For the https callback, Chrome checks that the site lists the app in
its Digital Asset Links (`/.well-known/assetlinks.json`), which the API will
serve before the Play Store release.

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
