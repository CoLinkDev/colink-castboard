// CastBoard's only boundary to its native hosts and external protocol data.
(() => {
  const { compareSemver, log } = window.castBoardUtils;
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang") || "";
  const mediaControlActions = new Set(["play", "pause", "next", "previous"]);
  const responseTimeoutMs = 10_000;
  const heartbeatIntervalMs = 5_000;
  const legacyBusinessTypes = Object.freeze({
    "music.v1.track": "music.track",
    "music.v1.lyric": "music.lyric",
    "music.v1.progress": "music.progress",
    "sysinfo.v1.stats": "sysinfo.stats",
  });
  let ipc = window.castboardIPC;

  if (!ipc && typeof window.castBoardUtils?.createMockIPC === "function") {
    ipc = window.castBoardUtils.createMockIPC();
    window.castboardIPC = ipc;
    log("host-bridge", "mock-ipc-created");
  }

  const peerBusinessVersion = params.get("peerBusinessVersion") || "";
  const config = Object.freeze({
    language,
    peerBusinessVersion,
    debug: params.has("debug"),
  });
  const featureGates = Object.freeze({
    sysinfoBasic: compareSemver(peerBusinessVersion, "1.1.0") >= 0,
    mediaControl: supportsBusinessProtocol(peerBusinessVersion, "1.6.0"),
  });
  const listeners = new Map();
  const pendingResponses = new Map();
  const heartbeatTimers = { music: 0, sysinfo: 0 };
  let nextId = 1;
  let hostReady = false;
  let pageReadyPromise = null;

  if (!ipc || typeof ipc.send !== "function" || typeof ipc.subscribe !== "function") {
    throw new Error("CastBoard IPC is unavailable");
  }

  function on(type, handler) {
    if (typeof type !== "string" || !type) {
      throw new TypeError("CastBoard event type must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError("CastBoard event handler must be a function");
    }

    let typeListeners = listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      listeners.set(type, typeListeners);
    }
    typeListeners.add(handler);
    return () => {
      typeListeners.delete(handler);
      if (typeListeners.size === 0) listeners.delete(type);
    };
  }

  function dispatch(type, payload, event) {
    const typeListeners = listeners.get(type);
    if (!typeListeners) return;
    for (const listener of typeListeners) {
      try {
        listener(payload, event);
      } catch (error) {
        log("host-bridge", "event-handler-failed", { type, error: String(error) });
      }
    }
  }

  function sendEvent({ type, id, payload = {} }) {
    const event = { channel: "castboard", type, payload };
    if (id) event.id = id;
    log("host-bridge", "event-sent", event);
    try {
      return Promise.resolve(ipc.send(event));
    } catch (error) {
      log("host-bridge", "event-send-failed", { type, error: String(error) });
      return Promise.reject(error);
    }
  }

  function sendEventWithResponse(type, payload = {}) {
    const id = String(nextId++);
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingResponses.delete(id);
        reject(new Error(`CastBoard host response timed out for ${type}`));
      }, responseTimeoutMs);
      pendingResponses.set(id, { resolve, reject, timeoutId });
      sendEvent({ type, id, payload }).catch((error) => {
        const pending = pendingResponses.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timeoutId);
        pendingResponses.delete(id);
        reject(error);
      });
    });
  }

  function resolvePendingResponse(event) {
    if (!event.id) return;
    const pending = pendingResponses.get(event.id);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingResponses.delete(event.id);
    if (event.payload?.ok === false) {
      pending.reject(new Error(event.payload.error || "CastBoard host rejected the event"));
    } else {
      pending.resolve(event.payload);
    }
  }

  function sendHeartbeat(domain) {
    if (!hostReady) return;
    void sendEvent({ type: `${domain}.alive`, payload: {} }).catch((error) => {
      log("host-bridge", "heartbeat-send-failed", { domain, error: String(error) });
    });
  }

  function startHeartbeat(domain) {
    if (heartbeatTimers[domain]) return;
    sendHeartbeat(domain);
    heartbeatTimers[domain] = window.setInterval(() => sendHeartbeat(domain), heartbeatIntervalMs);
  }

  function stopHeartbeat(domain) {
    if (!heartbeatTimers[domain]) return;
    window.clearInterval(heartbeatTimers[domain]);
    heartbeatTimers[domain] = 0;
  }

  function markHostReady() {
    if (hostReady) return;
    hostReady = true;
    log("host-bridge", "host-ready-received");
    for (const domain of Object.keys(heartbeatTimers)) {
      if (heartbeatTimers[domain]) sendHeartbeat(domain);
    }
    window.dispatchEvent(new Event("castboard-host-ready"));
  }

  function normalizeIncomingEvent(message) {
    if (!message || message.channel !== "castboard") return null;
    if (message.kind && message.kind !== "event") return null;
    if (message.type === "business") {
      const type = legacyBusinessTypes[message.payload?.type];
      return type ? { channel: "castboard", type, payload: message.payload?.payload ?? {} } : null;
    }
    const type = legacyBusinessTypes[message.type] || message.type;
    return { channel: "castboard", type, id: message.id, payload: message.payload ?? {} };
  }

  function notifyPageReady() {
    if (pageReadyPromise) return pageReadyPromise;
    pageReadyPromise = sendEventWithResponse("page.ready", {}).then((payload) => {
      markHostReady();
      return payload;
    }).catch((error) => {
      pageReadyPromise = null;
      throw error;
    });
    return pageReadyPromise;
  }

  function onHostReady(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("CastBoard host-ready listener must be a function");
    }
    if (hostReady) {
      listener();
      return () => {};
    }
    return on("host.ready", listener);
  }

  function close() {
    return sendEvent({ type: "app.close", payload: {} });
  }

  function openDevTools() {
    return sendEvent({ type: "app.openDevTools", payload: {} });
  }

  function sendMediaControl(action) {
    if (!mediaControlActions.has(action)) {
      return Promise.reject(new TypeError(`Unsupported media control action: ${String(action)}`));
    }
    return sendEvent({ type: "media.control", payload: { action } });
  }

  window.castBoardHost = Object.freeze({
    config,
    featureGates,
    on,
    sendEvent,
    sendEventWithResponse,
    notifyPageReady,
    onHostReady,
    isHostReady: () => hostReady,
    startMusicAlive: () => startHeartbeat("music"),
    stopMusicAlive: () => stopHeartbeat("music"),
    startSysInfoAlive: () => startHeartbeat("sysinfo"),
    stopSysInfoAlive: () => stopHeartbeat("sysinfo"),
    close,
    openDevTools,
    sendMediaControl,
  });

  ipc.subscribe((message) => {
    const event = normalizeIncomingEvent(message);
    log("host-bridge", "event-received", event || { ignored: true });
    if (!event?.type) return;
    resolvePendingResponse(event);
    if (event.type === "host.ready" && event.payload?.ok !== false) markHostReady();
    dispatch(event.type, event.payload, event);
  });

  if (language) document.documentElement.setAttribute("lang", language);
  log("host-bridge", "host-bridge-ready", { config, featureGates });

  function supportsBusinessProtocol(version, minimumVersion) {
    const parsedVersion = parseBusinessVersion(version);
    const parsedMinimum = parseBusinessVersion(minimumVersion);
    if (!parsedVersion || !parsedMinimum || parsedVersion.major !== parsedMinimum.major) return false;
    return compareSemver(version, minimumVersion) >= 0;
  }

  function parseBusinessVersion(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim());
    return match ? { major: Number(match[1]) } : null;
  }
})();
