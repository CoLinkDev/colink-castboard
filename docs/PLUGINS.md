# CastBoard Plugin Specification

## 1. Status and terminology

This document defines manifest schema version `1.0.0` and the runtime contract between CastBoard and built-in, development, and host-registered plugins.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

## 2. Plugin package

A plugin is an ES module and its package-relative resources. An unpacked package normally has this layout:

```text
my-plugin/
├── manifest.json
├── index.js
├── style.css
└── assets/
```

The package root is identified by `baseUrl`. The entry module and every path passed to `assets.resolveAsset()` are resolved relative to that URL. A host SHOULD provide a directory URL ending in `/`.

Plugins execute in the CastBoard document. Their UI is isolated by a Shadow DOM root, but their JavaScript is not sandboxed. A host MUST treat every registered plugin as trusted code.

## 3. Manifest

### 3.1 Example

```json
{
  "schemaVersion": "1.0.0",
  "id": "com.example.weather",
  "name": {
    "en": "Weather",
    "zh-CN": "天气"
  },
  "description": {
    "en": "Displays current weather conditions.",
    "zh-CN": "显示当前天气状况。"
  },
  "version": "1.0.0",
  "minCastBoardVersion": "1.0.0",
  "type": "navigable",
  "entry": "index.js"
}
```

### 3.2 Fields

| Field | Required | Type | Contract |
| --- | --- | --- | --- |
| `schemaVersion` | Yes | string | Manifest schema version in restricted SemVer form. Authors targeting this specification MUST use `1.0.0`. |
| `id` | Yes | string | Non-empty identifier. It MUST be unique within one CastBoard runtime. |
| `name` | Yes | localized strings | User-facing plugin name. |
| `description` | No | localized strings | User-facing summary of the plugin. |
| `version` | Yes | string | Plugin release version in restricted SemVer form. |
| `minCastBoardVersion` | Yes | string | Oldest compatible CastBoard version in restricted SemVer form. |
| `type` | Yes | string | Either `navigable` or `transient`. |
| `entry` | Yes | string | Non-empty package-relative entry module path. |
| `icon` | No | implementation-defined | Reserved for host presentation. The current runtime MAY ignore it. |

The restricted SemVer form accepted by this schema is exactly three decimal components matching `^\d+\.\d+\.\d+$`. Pre-release and build suffixes are not accepted.

A localized strings value MUST be a non-empty object whose keys and values are non-empty strings. Keys SHOULD be BCP 47 language tags, and an `en` value SHOULD be present as the portable fallback. The current built-in locale order is English, Simplified Chinese, Japanese, Korean, Traditional Chinese, German, Spanish, and Russian.

Consumers MUST ignore unrecognized manifest fields so that compatible schema revisions can add metadata. The current runtime validates the syntax of `schemaVersion`; it does not negotiate schema features. Plugin authors therefore MUST NOT claim a schema version whose contract they do not implement.

## 4. Plugin module

The entry module MUST default-export an object. `mount` is REQUIRED. Every other lifecycle hook is optional, but a defined hook MUST be a function.

```js
export default {
  async mount(shadowRoot, context) {},
  async activate(shadowRoot, context) {},
  async deactivate(shadowRoot, context) {},
  async unmount(shadowRoot, context) {},
  async onResize(shadowRoot, context, metrics) {},
}
```

The runtime invokes hooks with the plugin object as `this`. It awaits returned promises and contains rejected hooks as plugin failures.

## 5. Lifecycle

The lifecycle state model is:

```text
registered ──mount──> mounted/inactive ──activate──> active
                           ▲                  │
                           └────deactivate────┘
                           │
                           └────unmount──────> registered

any lifecycle hook failure ──> failed
```

The following rules apply:

1. `mount` runs after the runtime creates a dedicated shell and open Shadow DOM root. It MUST create the plugin UI and MAY subscribe to low-cost events. A plugin MUST NOT assume that mounting also makes it visible.
2. `activate` runs whenever the plugin becomes the foreground page. It SHOULD render the latest state and start animation frames, polling, media, or other foreground work.
3. `deactivate` runs before the active page yields foreground ownership. It MUST suspend animation frames and high-frequency or foreground-only work.
4. `onResize` runs only for the active plugin and receives `{ width, height }` in CSS pixels.
5. `unmount` first causes an active plugin to be deactivated. It MUST release event subscriptions, timers, observers, network activity, and retained DOM references.
6. A plugin MUST tolerate more than one `activate`/`deactivate` cycle after a single `mount`.
7. A plugin MUST keep any background listener required to request temporary focus alive while mounted and inactive.

CastBoard mounts transient plugins during startup because they can schedule their own appearances. Navigable plugins may be mounted before their first activation or lazily when selected; code MUST support either order.

## 6. Context API

The context and its service objects are frozen. Plugins MUST treat them as immutable capabilities.

### 6.1 `events`

```js
const unsubscribe = context.events.on(type, handler)
```

`events.on` subscribes to a CastBoard host-bridge event and returns an unsubscribe function. The plugin MUST retain and invoke that function during `unmount` unless the subscription is otherwise known to have ended. DOM events generated inside CastBoard are ordinary browser events and MAY be consumed with `addEventListener` when appropriate.

### 6.2 `navigation`

```js
context.navigation.showTransient(durationMs)
context.navigation.requestTemporaryFocus(durationMs)
context.navigation.extendTemporaryFocus(durationMs)
```

`durationMs` MUST be a finite, non-negative number.

`showTransient` is available only to a plugin whose manifest type is `transient`. It displays that plugin above the current regular page for the requested duration, does not enter the navigable page chain, and does not update persisted navigation state. A repeated request replaces its pending dismissal timer.

`requestTemporaryFocus` is available only to a plugin whose manifest type is `navigable`. It asks CastBoard to display the calling plugin temporarily:

- CastBoard records the current navigable page as the return page.
- Navigation to the caller uses the normal page transition but does not update persisted navigation state.
- When the duration expires, CastBoard returns to the recorded page with a normal transition.
- A request is ignored when the caller is already current or is already the pending navigation target. Such a request does not create or extend a return timer.
- A permanent navigation initiated by a swipe, arrow key, indicator button, or another ordinary navigation request cancels temporary focus. The user's selected page remains active.
- If a transient page is visible when temporary focus expires, CastBoard preserves the transient page and changes its eventual return destination to the recorded regular page.

`extendTemporaryFocus` is available only to a plugin whose manifest type is `navigable`. If the calling plugin is currently displayed under an active temporary focus session, this method replaces the pending return timer with a fresh timer of `durationMs` and returns `true`. If the caller is not currently displayed under temporary focus, it has no effect and returns `false`.

A navigable plugin SHOULD request temporary focus in response to its own domain event rather than relying on host code to encode plugin-specific scheduling:

```js
let unsubscribe

export default {
  async mount(shadowRoot, context) {
    unsubscribe = context.events.on("example.updated", () => {
      void context.navigation.requestTemporaryFocus(5000)
    })
  },
  async unmount() {
    unsubscribe?.()
    unsubscribe = null
  },
}
```

### 6.3 `storage`

```js
context.storage.get(key)
context.storage.set(key, value)
```

Storage is backed by `localStorage` and namespaced as `castboard.plugin.<plugin-id>.<key>`. `set` JSON-serializes its value, and `get` returns the parsed value or `null` when the key does not exist. Values MUST be JSON-serializable. Parsing, serialization, quota, and browser storage errors are surfaced to the caller.

### 6.4 `i18n`

`context.i18n.language` is the host-selected language string captured when the plugin manager is created. Plugins SHOULD provide an English fallback for unsupported or empty values.

### 6.5 `assets`

```js
const url = context.assets.resolveAsset("assets/icon.svg")
```

`resolveAsset` returns an absolute URL resolved from the package root. It performs URL resolution only; it does not fetch, validate, or authorize the resource.

Native browser APIs including `fetch`, `WebSocket`, and `XMLHttpRequest` remain available and are not intercepted by the plugin runtime.

## 7. Navigation models

### 7.1 Navigable pages

`navigable` plugins participate in swipe, keyboard, and indicator navigation. Ordinary navigation persists the selected plugin id under `lyrics2screen.currentPage`. Failed or unavailable plugins are removed from the navigable page list.

### 7.2 Transient pages

`transient` plugins are excluded from swipe order and page indicators. They are top-level temporary pages intended for scheduled or event-driven presentations. The prior regular page is deactivated while a transient page is active and reactivated when it returns.

### 7.3 Temporary focus

Temporary focus is a scheduling mode for a `navigable` page, not a third plugin type. The target remains a normal navigable page and appears in the indicator. Only the persistence and automatic return behavior differ from ordinary navigation.

## 8. External registration

The host event `plugins.register` accepts one registration, an array of registrations, or an object containing a `plugins` array.

```json
{
  "manifest": {
    "schemaVersion": "1.0.0",
    "id": "com.example.weather",
    "name": { "en": "Weather" },
    "description": { "en": "Displays current weather conditions." },
    "version": "1.0.0",
    "minCastBoardVersion": "1.0.0",
    "type": "navigable",
    "entry": "index.js"
  },
  "baseUrl": "https://castboard.local/plugins/com.example.weather/"
}
```

Before importing the entry module, the loader validates `minCastBoardVersion` and rejects a plugin that requires a newer CastBoard version. Browser dynamic-import and CORS rules apply to remote entry URLs. After import, CastBoard validates the complete manifest, lifecycle object, and unique plugin id before registration.

Registration payloads are settled independently. One failed item in a batch does not prevent other valid items from registering.

## 9. Local development

Create an unpacked plugin at `src/plugins/dev/<plugin-name>/`, run `pnpm dev`, and open CastBoard with the `debug` query parameter. In debug mode the runtime reads `/__castboard_dev_plugins` and loads each discovered package through the external registration path.

The development server scans immediate child directories and includes only those containing a file named exactly `manifest.json`. To disable a development plugin without deleting it, rename that file, for example to `manifest.json.disabled`. Production builds exclude the entire `src/plugins/dev` directory.

## 10. Isolation, failures, and fallback

Each plugin receives a separate Shadow DOM root and host shell. This isolates selectors and most presentation styles, but it is not a security boundary: plugins share the document, global objects, storage origin, and network capabilities.

The runtime catches lifecycle failures, marks the plugin as failed, renders a localized unavailable state in that plugin shell, and emits an internal failure event. Navigation to a failed non-core page falls back to `lyrics` where possible. Entry import and registration failures occur before a shell exists and are reported through runtime logging.

Plugins SHOULD allow lifecycle errors to reject naturally. They SHOULD NOT hide programming errors behind broad exception handling merely to remain registered.
