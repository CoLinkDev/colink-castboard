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

## Host Integration

Keep this repository next to each host repository:

```text
colink-castboard/
colink-desktop/
colink-android/
```

Host release builds copy `colink-castboard/src/` into their bundled resources. The development server is not required for release builds.

- **Desktop:** `pnpm build` copies `src/` to `public/castboard/` before the Tauri frontend build.
- **Android:** Gradle copies `src/` into generated app assets before assets are merged.

## Project Structure

```text
src/                    CastBoard web assets
scripts/dev-server.mjs  Development server with live reload
```
