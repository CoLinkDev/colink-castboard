(() => {
  function log(scope, event, payload = null) {
    const now = new Date();
    const entry = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      time: now.toLocaleTimeString() + "." + String(now.getMilliseconds()).padStart(3, "0"),
      timestamp: now.toISOString(),
      scope: String(scope || "app"),
      event,
      data: copyLogPayload(payload),
    };

    console.debug(`[CastBoard][${entry.time}][${entry.scope}] ${event}`, entry.data);
    return entry;
  }

  function copyLogPayload(payload) {
    if (payload === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch (error) {
      console.warn("[CastBoard][log] payload-copy-failed", { error: String(error) });
      return String(payload);
    }
  }

  function compareSemver(a, b) {
    const left = String(a || "0.0.0").split(".").map(Number);
    const right = String(b || "0.0.0").split(".").map(Number);
    for (let index = 0; index < 3; index += 1) {
      const difference = (left[index] || 0) - (right[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function formatSeconds(value) {
    if (!Number.isFinite(value) || value <= 0) return "0:00";
    const total = Math.floor(value);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatDuration(milliseconds) {
    return formatSeconds(Math.max(0, Number(milliseconds || 0)) / 1000);
  }

  function clampUnit(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  function normalizeRate(value) {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, parsed);
  }

  function parseCssLength(raw, fallback) {
    const value = resolveCssLength(String(raw ?? "").trim());
    return Number.isFinite(value) ? value : fallback;
  }

  function resolveCssLength(raw) {
    if (raw === "") return NaN;

    const clampArgs = cssFunctionArgs(raw, "clamp");
    if (clampArgs?.length === 3) {
      const min = resolveCssLength(clampArgs[0]);
      const preferred = resolveCssLength(clampArgs[1]);
      const max = resolveCssLength(clampArgs[2]);
      if ([min, preferred, max].every(Number.isFinite)) {
        return Math.min(max, Math.max(min, preferred));
      }
    }

    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return NaN;
    if (raw.endsWith("rem")) {
      return value * readRootFontSize();
    }
    if (raw.endsWith("vh") || raw.endsWith("%")) {
      return (window.innerHeight * value) / 100;
    }
    if (raw.endsWith("vw")) {
      return (window.innerWidth * value) / 100;
    }
    return value;
  }

  function cssFunctionArgs(raw, name) {
    const prefix = `${name}(`;
    if (!raw.startsWith(prefix) || !raw.endsWith(")")) return null;

    const body = raw.slice(prefix.length, -1);
    const args = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        args.push(body.slice(start, index).trim());
        start = index + 1;
      }
    }

    args.push(body.slice(start).trim());
    return args;
  }

  function readRootFontSize() {
    const value = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(value) ? value : 100;
  }

  function readCssNumber(element, name, fallback) {
    return parseCssLength(getComputedStyle(element).getPropertyValue(name), fallback);
  }

  function cancelRaf(id) {
    if (id) cancelAnimationFrame(id);
    return 0;
  }

  function clearTimer(id) {
    if (id) window.clearTimeout(id);
    return 0;
  }

  class MockIPC {
    constructor() {
      this.subscribers = new Set();
      this.isMock = true;
      this._sysInfoTimer = null;
    }

    subscribe(callback) {
      if (typeof callback !== "function") return () => {};
      this.subscribers.add(callback);
      return () => this.subscribers.delete(callback);
    }

    dispatch(message) {
      log("mock-ipc", "event-sent", message);
      for (const subscriber of this.subscribers) {
        try {
          subscriber(message);
        } catch (error) {
          console.error("[MockIPC] subscriber error:", error);
        }
      }
    }

    dispatchEvent(type, payload = {}, id) {
      this.dispatch({
        channel: "castboard",
        type,
        payload,
        ...(id ? { id } : {}),
      });
    }

    send(event) {
      log("mock-ipc", "event-received", event);
      switch (event.type) {
        case "page.ready":
          setTimeout(() => {
            this.dispatchEvent("host.ready", { ok: true }, event.id);
          }, 80);
          break;
      }
      return Promise.resolve();
    }

    mockTrack(track = {}) {
      this.dispatchEvent("music.track", {
        trackId: track.trackId || "mock-track-1",
        title: track.title || "Sample Song Title",
        artists: track.artists || ["Sample Artist"],
        album: track.album || "Sample Album",
        source: track.source || "spotify",
        coverUrl: track.coverUrl || "",
        duration: track.duration != null ? track.duration : 210000,
        ...track,
      });
    }

    mockLyric(lines = [], translatedLines = []) {
      this.dispatchEvent("music.lyric", {
        lines: lines.length > 0 ? lines : [
          { time: 0, text: "Line 1 of sample lyrics" },
          { time: 5000, text: "Line 2 of sample lyrics" },
          { time: 10000, text: "Line 3 of sample lyrics" },
          { time: 15000, text: "Line 4 of sample lyrics" },
        ],
        translatedLines: translatedLines.length > 0 ? translatedLines : [
          { time: 0, text: "示例歌词第 1 行" },
          { time: 5000, text: "示例歌词第 2 行" },
          { time: 10000, text: "示例歌词第 3 行" },
          { time: 15000, text: "示例歌词第 4 行" },
        ],
      });
    }

    mockProgress(progressMs = 0, paused = false) {
      this.dispatchEvent("music.progress", {
        progress: progressMs,
        paused,
      });
    }

    mockSysInfo(stats = {}) {
      this.dispatchEvent("sysinfo.stats", {
        cpu: stats.cpu != null ? stats.cpu : Math.floor(Math.random() * 50 + 20),
        mem: stats.mem != null ? stats.mem : 56,
        gpu: stats.gpu != null ? stats.gpu : 30,
        net_up: stats.net_up != null ? stats.net_up : 1024 * 300,
        net_down: stats.net_down != null ? stats.net_down : 1024 * 1024 * 4.2,
        disk_read: stats.disk_read != null ? stats.disk_read : 1024 * 1024 * 18.5,
        disk_write: stats.disk_write != null ? stats.disk_write : 1024 * 512,
        ...stats,
      });
    }

    startMockSysInfoTicker(intervalMs = 2000) {
      if (this._sysInfoTimer) clearInterval(this._sysInfoTimer);
      this.mockSysInfo();
      this._sysInfoTimer = setInterval(() => this.mockSysInfo(), intervalMs);
    }

    stopMockSysInfoTicker() {
      if (this._sysInfoTimer) {
        clearInterval(this._sysInfoTimer);
        this._sysInfoTimer = null;
      }
    }
  }

  function createMockIPC() {
    return new MockIPC();
  }

  window.castBoardUtils = Object.freeze({
    cancelRaf,
    clampUnit,
    clearTimer,
    compareSemver,
    createMockIPC,
    cssFunctionArgs,
    formatDuration,
    formatSeconds,
    MockIPC,
    normalizeRate,
    parseCssLength,
    readCssNumber,
    readRootFontSize,
    resolveCssLength,
    log,
  });
})();
