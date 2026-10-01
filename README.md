# CoLink CastBoard

Standalone CastBoard web surface shared by CoLink Desktop and CoLink Android.

**Tech stack:** HTML · CSS · JavaScript · Node.js development server

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/)

## Development

```sh
pnpm install
pnpm dev
```

The development server listens on port `5173`, serves `src/`, and reloads connected pages when files change.

## Build

```sh
pnpm build
```

Produces `dist/` with release-ready assets (fonts trimmed to CN + Google Sans Flex subsets). Host applications consume this output for bundling.

## Host Integration

Each host application includes this repository as a **git submodule** at `./castboard`. Release builds run `pnpm build` inside the submodule and copy `dist/` into their bundled resources.

- **Desktop:** `scripts/sync-castboard.mjs` triggers the build and copies `dist/` to `public/castboard/`.
- **Android:** Gradle `buildCastBoard` task runs `pnpm build`; `syncReleaseCastBoardAssets` copies `dist/` into generated app assets.

During development, both hosts connect to the dev server (port 5173) instead of using local files.

## Plugins

CastBoard pages use a common Shadow DOM plugin runtime. See [Plugin Development](docs/PLUGINS.md) for the manifest, lifecycle, external registration, and local development contracts.

## Project Structure

```text
src/                    CastBoard web assets (source of truth)
dist/                   Build output (gitignored)
scripts/dev-server.mjs  Development server with live reload
scripts/build.mjs       Release build script
```
