# MockIPC Browser Console Guide

MockIPC lets developers exercise CastBoard without a native host. Use it to push track, lyric, playback, and system-information events directly from the browser Console.

## 1. Start a mock session

Run the development server:

```sh
pnpm dev
```

Open `http://localhost:5173/` in a standalone browser tab. When no native bridge has populated `window.castboardIPC`, CastBoard creates a `MockIPC` instance automatically and assigns it to that property.

Verify that the tab is using the mock bridge:

```js
window.castboardIPC?.isMock === true
```

If the result is not `true`, the page is using another IPC implementation and the mock helper methods may not exist. Do not replace an injected native bridge from the Console; use a standalone browser tab instead.

The system-information plugin is gated by the peer Business Protocol version. To test it, open:

```text
http://localhost:5173/?peerBusinessVersion=1.2.0
```

Add `&debug` only when development plugins under `src/plugins/dev` also need to be loaded.

## 2. Read the communication log

CastBoard writes IPC diagnostics with `console.debug`. Enable the **Verbose** log level in DevTools, then filter for `mock-ipc` or `host-bridge`.

Mock events sent into CastBoard produce a pair like this:

```text
[CastBoard][...][mock-ipc] event-sent       { channel: "castboard", type: "music.track", ... }
[CastBoard][...][host-bridge] event-received { channel: "castboard", type: "music.track", ... }
```

Events sent by CastBoard to the mock host, including `page.ready` and heartbeats, produce the reverse pair:

```text
[CastBoard][...][host-bridge] event-sent    { channel: "castboard", type: "music.alive", ... }
[CastBoard][...][mock-ipc] event-received   { channel: "castboard", type: "music.alive", ... }
```

`MockIPC.dispatch()` is synchronous. Its `event-sent` entry therefore appears immediately before the matching `host-bridge` `event-received` entry.

## 3. Copy-and-paste recipes

### Complete music state

```js
{
  const ipc = window.castboardIPC;
  ipc.mockTrack({
    trackId: "mock-complete-state",
    title: "Midnight Signals",
    artists: ["CastBoard Test Artist"],
    album: "Browser Console Sessions",
    source: "ncm",
    duration: 180000,
  });
  ipc.mockLyric(
    [
      { time: 0, text: "The city wakes beneath the glow" },
      { time: 5000, text: "Signals travel through the night" },
      { time: 10000, text: "Every window holds a story" },
      { time: 15000, text: "Every heartbeat keeps the time" },
    ],
    [
      { time: 0, text: "城市在微光下醒来" },
      { time: 5000, text: "信号穿过夜色" },
      { time: 10000, text: "每扇窗都有一个故事" },
      { time: 15000, text: "每次心跳都守着节拍" },
    ],
  );
  ipc.mockProgress(6500, false);
}
```

### Track change and temporary focus

Open CastBoard with `?peerBusinessVersion=1.2.0`, then run:

```js
await window.navManager.navigateTo("sysinfo");
window.castboardIPC.mockTrack({
  trackId: `mock-${Date.now()}`,
  title: `Incoming Track ${new Date().toLocaleTimeString()}`,
  artists: ["Temporary Focus Test"],
  source: "spotify",
});
```

Changing the displayed track information while the lyrics plugin is inactive requests temporary focus for the lyrics page. It returns to the system-information page after five seconds. Keep the unique title in this recipe: the current display state does not treat a `trackId`-only change as a visible track change.

### Long lyrics with translations

```js
{
  const ipc = window.castboardIPC;
  const lines = Array.from({ length: 32 }, (_, index) => ({
    time: index * 3000,
    text: `Primary lyric line ${String(index + 1).padStart(2, "0")}`,
  }));
  const translatedLines = lines.map(({ time }, index) => ({
    time,
    text: `翻译歌词第 ${index + 1} 行`,
  }));
  ipc.mockTrack({
    trackId: "mock-long-lyrics",
    title: "Long Lyrics Scroll Test",
    artists: ["CastBoard QA"],
    source: "ytmusic",
    duration: lines.length * 3000,
  });
  ipc.mockLyric(lines, translatedLines);
  ipc.mockProgress(0, false);
}
```

Jump to a later line without waiting:

```js
window.castboardIPC.mockProgress(60000, false)
```

### Live system information

Open CastBoard with `?peerBusinessVersion=1.2.0`, navigate to the system-information page so that its event subscription is mounted, and start the ticker:

```js
await window.navManager.navigateTo("sysinfo");
window.castboardIPC.startMockSysInfoTicker(1000);
```

Stop it when finished:

```js
window.castboardIPC.stopMockSysInfoTicker()
```

### Clear the current track

```js
window.castboardIPC.mockTrack({
  trackId: null,
  title: null,
  artists: null,
  album: null,
  source: null,
  coverUrl: null,
  coverData: null,
  duration: null,
})
```

## 4. API reference

All helpers are methods of `window.castboardIPC` in a mock session.

### `mockTrack(track = {})`

Dispatches a `music.track` event. Missing fields receive sample defaults; explicitly supplied values, including `null`, override those defaults. Additional properties are forwarded in the payload.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `trackId` | string or null | `"mock-track-1"` | Source-defined track identifier. `null` clears playback state. |
| `title` | string or null | `"Sample Song Title"` | Track title. |
| `artists` | string[] or null | `["Sample Artist"]` | Artist names. |
| `album` | string or null | `"Sample Album"` | Album name. |
| `source` | string or null | `"spotify"` | Player source identifier used for the source icon. |
| `coverUrl` | string or null | `""` | Cover image URL. |
| `coverData` | string or null | omitted | Base64-encoded PNG cover data; takes precedence over `coverUrl`. |
| `duration` | number or null | `210000` | Track duration in milliseconds. |

The lyrics view currently has icon mappings for these nine source IDs:

| Source ID | Displayed service |
| --- | --- |
| `ncm` | NetEase Cloud Music |
| `qqmusic` | QQ Music |
| `applemusic` | Apple Music |
| `spotify` | Spotify |
| `ytmusic` | YouTube Music |
| `bilibili` | Bilibili |
| `tidal` | TIDAL |
| `deezer` | Deezer |
| `kugou` | Kugou Music |

`neteasecloudmusic` is also accepted as a compatibility alias for `ncm`. Other strings are accepted by the mock event but render without a source icon.

### `mockLyric(lines = [], translatedLines = [])`

Dispatches a `music.lyric` event. Each array contains objects with this shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `time` | number | Timestamp from the track start, in milliseconds. |
| `text` | string | Text displayed for that timestamp. |

Translations are matched to primary lines by exact `time` value. Passing an empty array selects the built-in four-line sample for that argument; it does not clear the lyrics.

### `mockProgress(progressMs = 0, paused = false)`

Dispatches a `music.progress` event.

| Argument | Type | Meaning |
| --- | --- | --- |
| `progressMs` | number | Playback position in milliseconds. |
| `paused` | boolean | `true` pauses local progress interpolation; `false` resumes it. |

### `mockSysInfo(stats = {})`

Dispatches one `sysinfo.stats` event. Missing metrics receive sample values.

| Field | Unit |
| --- | --- |
| `cpu`, `mem`, `gpu` | Percentage from 0 to 100 |
| `net_up`, `net_down` | Bytes per second |
| `disk_read`, `disk_write` | Bytes per second |

Example:

```js
window.castboardIPC.mockSysInfo({
  cpu: 92.5,
  mem: 68,
  gpu: null,
  net_up: 512 * 1024,
  net_down: 8 * 1024 * 1024,
  disk_read: 24 * 1024 * 1024,
  disk_write: 2 * 1024 * 1024,
})
```

### `startMockSysInfoTicker(intervalMs = 2000)`

Sends one system-information sample immediately, then sends randomized/default samples at the requested interval. Starting it again replaces the existing ticker.

### `stopMockSysInfoTicker()`

Stops the active system-information ticker. It is safe to call when no ticker is running.

## 5. Plugin lifecycle notes

- Mock events are not queued. Send them after the relevant listener has been registered.
- Music state listeners are installed during application startup, and the built-in lyrics plugin is mounted during boot even when another navigable page is active.
- The system-information listener is registered when that plugin is mounted. Navigate to `sysinfo` before sending a one-shot `mockSysInfo()` event, or start the ticker so that later samples arrive after mounting.
- A visible track change requests five seconds of temporary lyrics focus when the lyrics plugin is inactive. Further visible track changes during that temporary-focus session restart the five-second timer.
- Reloading the page creates a fresh MockIPC instance and clears all mock state and timers.
