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
  const ipc = window.castboardIPC;

  if (!ipc) {
    throw new Error("CastBoard IPC is unavailable");
  }

  function registerHandlers(nextHandlers) {
    Object.assign(handlers, nextHandlers);
    log("host-bridge", "host-handlers-registered", { handlers: Object.keys(nextHandlers) });
  }

  function dispatchMusicBusinessEvent(type, payload) {
    handlers.onMusicBusinessEvent?.(type, payload);
  }

  function dispatchSysInfoStats(payload) {
    handlers.onSysInfoStats?.(payload);
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
    log("host-bridge", "close-requested");
    return ipc.request({ type: "castboard.close", payload: {} });
  }

  function openDevTools() {
    log("host-bridge", "open-devtools-requested");
    return ipc.request({ type: "castboard.openDevTools", payload: {} });
  }

  window.castBoardHost = Object.freeze({
    config,
    featureGates,
    registerHandlers,
    close,
    openDevTools,
  });
  ipc.subscribe((message) => {
    if (
      message?.channel !== "castboard" ||
      message.kind !== "event" ||
      message.type !== "business"
    ) {
      return;
    }
    handleBusinessEvent(message.payload?.type, message.payload?.payload);
  });

  if (language) {
    document.documentElement.setAttribute("lang", language);
  }
  log("host-bridge", "host-bridge-ready", { config, featureGates });

  window.addEventListener("load", () => {
    ipc.request({ type: "castboard.ready", payload: {} }).catch((error) => {
      log("host-bridge", "ready-request-failed", { error: String(error) });
    });
  }, { once: true });
})();
