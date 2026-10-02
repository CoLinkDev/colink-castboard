# CoLink CastBoard

Standalone CastBoard web surface shared by CoLink Desktop and CoLink Android.

**Tech stack:** HTML · CSS · JavaScript · Vite

## Requirements

- Node.js 20.19+ or 22.12+
- [pnpm](https://pnpm.io/)

## Development

```sh
pnpm install
pnpm dev
```

The Vite development server listens on `0.0.0.0:5173`, supports local-network device testing, and exposes unpacked development plugins from `src/plugins/dev/`.

## Build

```sh
pnpm build
```

Produces `dist/` with release-ready assets (fonts trimmed to CN + Google Sans Flex subsets). Builds from a release tag embed that tag's semantic version; untagged local builds embed a Git hash with a `-dev` suffix.

## Host Integration

Tagged releases publish `castboard-dist.zip`, containing the top-level `dist/` directory. Host applications declare a CastBoard version and download that immutable release asset into a version-isolated build cache.

- **Desktop:** `scripts/sync-castboard.mjs` restores the declared release or uses `COLINK_CASTBOARD_LOCAL_PATH`, then copies it to `public/castboard/`.
- **Android:** Gradle restores the declared release or uses `CASTBOARD_LOCAL_PATH`, then copies it into generated app assets.

During development, both hosts connect to the dev server (port 5173) instead of using local files.

## Plugins

CastBoard pages use a common Shadow DOM plugin runtime. See [Plugin Development](docs/PLUGINS.md) for the manifest, lifecycle, external registration, and local development contracts.

## Project Structure

```text
src/                    CastBoard web assets (source of truth)
dist/                   Build output (gitignored)
vite.config.mjs         Development server and release build configuration
```
