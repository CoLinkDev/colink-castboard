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
    } catch {
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

  window.castBoardUtils = Object.freeze({
    cancelRaf,
    clampUnit,
    clearTimer,
    compareSemver,
    cssFunctionArgs,
    formatDuration,
    formatSeconds,
    normalizeRate,
    parseCssLength,
    readCssNumber,
    readRootFontSize,
    resolveCssLength,
    log,
  });
})();
