// CastBoard's only boundary to its native hosts and external protocol data.
(() => {
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang") || "";
  const peerBusinessVersion = params.get("peerBusinessVersion") || "";
  const config = Object.freeze({
    language,
    peerBusinessVersion,
    debug: params.has("debug"),
  });
  const featureGates = Object.freeze({
    sysinfoBasic: compareSemver(peerBusinessVersion, "1.1.0") >= 0,
  });
  const handlers = {};
  const hostReadyListeners = new Set();
  const ipc = window.castboardIPC;
  let hostReady = false;
  let pageReadySent = false;

  if (!ipc) {
    throw new Error("CastBoard IPC is unavailable");
  }

  function registerHandlers(nextHandlers) {
    Object.assign(handlers, nextHandlers);
    log("host-bridge", "host-handlers-registered", { handlers: Object.keys(nextHandlers) });
  }

  function notifyPageReady() {
    if (pageReadySent) {
      return Promise.resolve();
    }

    pageReadySent = true;
    return requestHost("castboard.ready", {}).catch((error) => {
      pageReadySent = false;
      throw error;
    });
  }

  function requestHost(type, payload) {
    log("host-bridge", "request-sent", { type, payload });
    try {
      return Promise.resolve(ipc.request({ type, payload })).then(
        (result) => {
          log("host-bridge", "response-received", { type, result });
          return result;
        },
        (error) => {
          log("host-bridge", "request-failed", { type, error: String(error) });
          throw error;
        },
      );
    } catch (error) {
      log("host-bridge", "request-failed", { type, error: String(error) });
      return Promise.reject(error);
    }
  }

  function notifyHostReadyListener(listener) {
    try {
      listener();
    } catch (error) {
      log("host-bridge", "host-ready-listener-failed", { error: String(error) });
    }
  }

  function onHostReady(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("CastBoard host-ready listener must be a function");
    }
    if (hostReady) {
      notifyHostReadyListener(listener);
      return () => {};
    }
    hostReadyListeners.add(listener);
    return () => hostReadyListeners.delete(listener);
  }

  function markHostReady() {
    if (hostReady) {
      return;
    }

    hostReady = true;
    log("host-bridge", "host-ready-received");
    for (const listener of hostReadyListeners) {
      notifyHostReadyListener(listener);
    }
    hostReadyListeners.clear();
    window.dispatchEvent(new Event("castboard-host-ready"));
  }

  function dispatchMusicBusinessEvent(type, payload) {
    try {
      handlers.onMusicBusinessEvent?.(type, payload);
    } catch (error) {
      log("host-bridge", "music-event-handler-failed", { type, error: String(error) });
    }
  }

  function dispatchSysInfoStats(payload) {
    try {
      handlers.onSysInfoStats?.(payload);
    } catch (error) {
      log("host-bridge", "sysinfo-event-handler-failed", { error: String(error) });
    }
  }

  function handleBusinessEvent(type, payload) {
    log("host-bridge", "business-message-received", { type, payload });
    switch (type) {
      case "music.v1.track":
      case "music.v1.lyric":
      case "music.v1.progress":
        dispatchMusicBusinessEvent(type, payload);
        break;
      case "sysinfo.v1.stats":
        if (featureGates.sysinfoBasic) {
          dispatchSysInfoStats(payload);
        }
        break;
    }
  }

  function close() {
    return requestHost("castboard.close", {});
  }

  function openDevTools() {
    return requestHost("castboard.openDevTools", {});
  }

  window.castBoardHost = Object.freeze({
    config,
    featureGates,
    registerHandlers,
    notifyPageReady,
    onHostReady,
    isHostReady: () => hostReady,
    close,
    openDevTools,
  });
  ipc.subscribe((message) => {
    log("host-bridge", "event-received", {
      channel: message?.channel,
      kind: message?.kind,
      type: message?.type,
      payload: message?.payload,
    });
    if (message?.channel !== "castboard" || message.kind !== "event") {
      log("host-bridge", "event-ignored", { reason: "invalid-envelope" });
      return;
    }
    if (message.type === "host.ready") {
      markHostReady();
      return;
    }
    if (message.type === "business") {
      handleBusinessEvent(message.payload?.type, message.payload?.payload);
    }
  });

  if (language) {
    document.documentElement.setAttribute("lang", language);
  }
  log("host-bridge", "host-bridge-ready", { config, featureGates });
})();
