# Hop

**Upload it on my Hop.** At an event, an athlete tells everyone who filmed them to upload their clips on [onmyhop.com](https://onmyhop.com). Every video lands in one private inbox. Nobody needs an app or an account to contribute.

Hop is a small product from [Caliplaces](https://caliplaces.com) and is developed in the open.

## Repository layout

```
apps/
  api/      Cloudflare Worker (Hono): REST API, OIDC sign-in, R2 upload signing; also serves the web build
  web/      React + Vite web app: landing page, contributor upload page, athlete inbox
packages/
  shared/            Zod schemas, limits and helpers shared by the API and the web app
  typescript-config/ Shared tsconfig presets
```

## Stack

- **Cloudflare Workers** with **Hono** for the API
- **Cloudflare D1** (SQLite) with **Drizzle** for metadata
- **Cloudflare R2** for files. The bucket is private, and browsers upload straight to it through short-lived presigned multipart URLs.
- **Sign in with Caliplaces** (OIDC, see [developer.caliplaces.com](https://developer.caliplaces.com))
- **Turborepo** + **pnpm** workspaces, **Biome** for lint and formatting

## Getting started

Requires Node 24 and pnpm 10.

```sh
pnpm install
pnpm dev
```

See [`apps/api/README.md`](apps/api/README.md) for local secrets, how uploads work, and Cloudflare setup.

## License

Copyright © Caliplaces.

Hop is free software, released under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). You can use, study, modify and self-host it. If you run a modified version as a network service, the AGPL requires you to offer its source code to that service's users under the same license.
