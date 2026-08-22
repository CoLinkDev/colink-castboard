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

  function requestDesktopAction(action) {
    log("host-bridge", "desktop-action-requested", { action });
    window.location.assign(`https://castboard-action.invalid/${action}`);
  }

  window.castBoardHost = Object.freeze({
    config,
    featureGates,
    registerHandlers,
    requestDesktopAction,
  });
  window.handleCoLinkBusinessEvent = handleBusinessEvent;

  if (language) {
    document.documentElement.setAttribute("lang", language);
  }
  log("host-bridge", "host-bridge-ready", { config, featureGates });
})();
