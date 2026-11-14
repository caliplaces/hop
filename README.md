<p align="center">
  <img src="apps/web/public/email/cheer-grape.png" width="168" alt="Bobble, Hop's mascot, celebrating" />
</p>

<h1 align="center">Hop</h1>

<p align="center">
  <strong>Upload it on my Hop.</strong><br />
  Every clip from the crowd, in one private inbox.
</p>

<p align="center">
  <a href="https://onmyhop.com">onmyhop.com</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://github.com/caliplaces/hop/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/caliplaces/hop/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-7C4DFF" /></a>
</p>

At a competition, a jam or a training session, everyone around you is filming. Hop gets those clips to you. Say _“upload it on my Hop”_, and people send their videos straight from their phones to your private inbox. Nobody has to install an app or make an account.

## How it works

**For athletes**

1. Claim your link, like `onmyhop.com/yourname`.
2. Share it, or show your QR code at the event.
3. Get every angle in one inbox, in full quality, sorted by event.

**For everyone filming**

1. Open the athlete's link.
2. Pick your clips and send them, up to 5 GB each.
3. That’s it: no app, no sign-up.

## Privacy

- Only the athlete sees what was sent to them. There's no public gallery.
- Contributors can stay anonymous, or sign in to put their name on their clips.
- Files go straight from the phone to private storage, and they're only ever shared through links that expire within minutes.

## Development

You'll need Node 24 and pnpm 10.

```sh
pnpm install
pnpm dev
```

Then open [localhost:5173](http://localhost:5173). Local configuration is documented in [`apps/api/README.md`](apps/api/README.md).

| Folder            | What's inside                                            |
| ----------------- | -------------------------------------------------------- |
| `apps/web`        | The website: landing page, upload page and athlete inbox |
| `apps/api`        | The server behind it                                     |
| `packages/shared` | Code both use: validation, limits and colours            |

Pull requests go to the `staging` branch; see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately, as described in [SECURITY.md](SECURITY.md).

## License

Copyright © [Caliplaces](https://caliplaces.com).

Hop is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, study, change and self-host it. If you run a modified version as a service, the license requires you to share its source with that service's users.
