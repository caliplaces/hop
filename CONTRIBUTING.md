# Contributing to Hop

Thanks for helping out!

## Branches

- **`staging`** is where work lands. Open your pull request against `staging`.
- **`main`** is what runs on [onmyhop.com](https://onmyhop.com). It only receives releases from `staging`.

Merged pull requests deploy automatically: `staging` to staging.onmyhop.com, `main` to onmyhop.com.

## Pull requests

1. Branch off `staging` and open a pull request back into `staging`.
2. CI must pass: `pnpm lint`, `pnpm check-types`, `pnpm test` and `pnpm build`. Run them locally first. Changes to `apps/ios` also build the iPhone app and run its tests; see [`apps/ios/README.md`](apps/ios/README.md). Changes to `apps/android` build the Android app and run its tests and lint; see [`apps/android/README.md`](apps/android/README.md).
3. A maintainer reviews and squash-merges it.

Workflows on pull requests from first-time and outside contributors run after a maintainer approves them.

## Local development

See the [README](README.md) and [`apps/api/README.md`](apps/api/README.md).

## Security

Please don't open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).
