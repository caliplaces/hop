# Hop for iPhone

The native iOS app, built with SwiftUI and Liquid Glass. In so far: the welcome
bubble, Sign in with Caliplaces, claiming a Hop link, the inbox (events, clips,
a full-screen player, saving to Photos and sharing), the Hop pass, quick
access to the QR code and Event mode. The Wallet pass and "Share to Hop" come
next.

The Hop pass, on the My Hop tab, is the athlete's card: their colour with a
holographic foil (a Metal shader) that shifts as the phone tilts or a finger
turns it, Bobble peeking over the top, the QR code on white so it always
scans, and their clips and events. It can be shared as a story-sized image.

The QR code is a move away from anywhere: a Home Screen widget shows it, and a
Lock Screen widget, a Control Center control and the "Show my Hop QR code"
shortcut (Siri, Spotlight, the Action button) open it full screen, or Event
mode's screen while that runs. The app shares the athlete's link with the
widgets through the `group.com.onmyhop.app` app group, and clears it when they
sign out.

Event mode puts the QR code full screen, keeps the screen on, and counts the
clips that come in, in the app and as a Live Activity on the Lock Screen and in
the Dynamic Island. While the app is open it checks for clips itself; with the
phone locked, the API pushes each update to the Live Activity through APNs.
Debug builds get sandbox push tokens, which staging can push to. See "Live
Activity pushes" in apps/api/README.md.

## Running it

You'll need Xcode 26 or newer.

1. Open `Hop.xcodeproj`.
2. Pick an iPhone simulator and press Run.

The welcome bubble is drawn with Metal shaders. If the build asks for the Metal
toolchain, install it from Xcode → Settings → Components, or run
`xcodebuild -downloadComponent MetalToolchain`.

To run on your own iPhone, create `Config/Local.xcconfig` containing
`DEVELOPMENT_TEAM = <your team ID>`. Git ignores that file.

Debug builds talk to staging.onmyhop.com and sign in with a real Caliplaces
account. To use the API running on this Mac instead, add the launch argument
`-HopAPIURL http://127.0.0.1:8787` to the Run scheme. Sign out from the account
menu to see the welcome bubble again.

## Tests

```sh
xcodebuild test -project Hop.xcodeproj -scheme Hop \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

`PaletteTests` checks the app's colours against `packages/shared/src/colors.ts`,
so run the tests from a full checkout of the repository.

## What's where

| Folder                 | What's inside                                               |
| ---------------------- | ----------------------------------------------------------- |
| `Hop/App`              | The app's entry point and sign-in state                     |
| `Hop/DesignSystem`     | Aura and shimmering text                                    |
| `Hop/Features/Welcome` | The welcome bubble: geometry, Metal shaders, haptics        |
| `Hop/Features/Account` | Claiming a handle and picking a colour                      |
| `Hop/Features/Inbox`   | Events, clip grids, the player, save and share              |
| `Hop/Features/MyHop`   | The Hop pass: link, QR code, foil shader, tilt, story image |
| `Hop/Features/Event`   | Event mode: setup, the full-screen QR code, the clip count  |
| `Hop/Features/Home`    | The signed-in tabs                                          |
| `Hop/Networking`       | The API client and Keychain token storage                   |
| `HopWidgets`           | QR code widget and control, Event mode's Live Activity      |
| `Shared`               | Shared with the widgets: palette, QR codes, links, intents  |
| `HopTests`             | Unit tests                                                  |
| `Config`               | Build settings, as `.xcconfig` files                        |

New files in `Hop/`, `HopWidgets/`, `Shared/` and `HopTests/` are part of the
build automatically, with no project edits needed. Files in `Shared/` are built
into both the app and the widget extension.

Bobble's images and face, in every athlete colour, and the app icon are
rendered from the website's 3D mascot:

```sh
pnpm --filter @hop/web mascot:assets ios
```
