# CastBoard Plugin Development

CastBoard plugins are ES modules rendered inside isolated Shadow DOM roots. Built-in and external pages use the same lifecycle and context contract.

## Package layout

```text
my-plugin/
├── manifest.json
├── index.js
├── style.css
└── assets/
```

The manifest fields are `id`, localized `name`, `version`, `minCastBoardVersion`, `type` (`navigable` or `transient`), `entry`, and optional `icon`.

```json
{
  "id": "com.example.weather",
  "name": { "en": "Weather", "zh-CN": "天气" },
  "version": "1.0.0",
  "minCastBoardVersion": "1.0.0",
  "type": "navigable",
  "entry": "index.js"
}
```

## Module contract

The entry module default-exports an object. `mount` is required; the other hooks are optional.

```js
export default {
  async mount(shadowRoot, context) {},
  async activate(shadowRoot, context) {},
  async deactivate(shadowRoot, context) {},
  async unmount(shadowRoot, context) {},
  async onResize(shadowRoot, context, metrics) {},
}
```

`mount` runs once for an installed page. `activate` and `deactivate` bracket foreground visibility. Plugins must suspend animation frames and high-frequency work while deactivated. `unmount` releases all resources.

The context exposes:

- `events.on(type, handler)`, returning an unsubscribe function.
- `navigation.showTransient(durationMs)` for transient plugins.
- `i18n.language`.
- namespaced JSON `storage.get(key)` and `storage.set(key, value)`.
- `assets.resolveAsset(path)` for package-relative URLs.

Native `fetch`, `WebSocket`, and `XMLHttpRequest` remain available without runtime interception.

## Local development

Create an unpacked plugin under `src/plugins/dev/<plugin-name>/`, start CastBoard with `pnpm dev`, and open it with the `debug` query parameter. The development server exposes the plugin index at `/__castboard_dev_plugins`; CastBoard loads entries through the same external loader used by host registration.

### Temporarily disabling a dev plugin

To temporarily disable a plugin in `src/plugins/dev/` without deleting it, rename its `manifest.json` (for example, to `manifest.json.disabled` or `manifest.bak`). The development server checks specifically for the existence of `manifest.json`; when absent, the plugin directory is automatically skipped during scanning.

The host-side `plugins.register` event accepts a single registration payload:

```json
{
  "manifest": { "id": "com.example.weather", "entry": "index.js" },
  "baseUrl": "https://castboard.local/plugins/com.example.weather/"
}
```

Hosts may also send an array of registration payloads or wrap that array as `{ "plugins": [...] }` for batch registration. `baseUrl` identifies the plugin package root; `entry` and paths passed to `assets.resolveAsset()` are resolved from that root.

CastBoard rejects a plugin before importing its entry module when `minCastBoardVersion` is newer than the running CastBoard version.

Lifecycle loading and hook failures are contained to the plugin page. CastBoard displays an unavailable state and returns navigation to `lyrics` when possible.
