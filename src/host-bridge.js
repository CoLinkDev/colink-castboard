// CastBoard's only boundary to its native hosts and external protocol data.
(() => {
  const { compareSemver } = window.castBoardUtils;
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lang") || "";
  const peerBusinessVersion = params.get("peerBusinessVersion") || "";
  const config = Object.freeze({
    language,
    peerBusinessVersion,
    desktop: params.has("castboard-desktop"),
    debug: params.has("debug"),
    devtools: params.has("castboard-devtools"),
  });
  const featureGates = Object.freeze({
    sysinfoBasic: compareSemver(peerBusinessVersion, "1.1.0") >= 0,
  });
  const handlers = {};

  function registerHandlers(nextHandlers) {
    Object.assign(handlers, nextHandlers);
  }

  function dispatchMusicBusinessEvent(type, payload) {
    handlers.onMusicBusinessEvent?.(type, payload);
  }

  function dispatchSysInfoStats(payload) {
    handlers.onSysInfoStats?.(payload);
  }

  function handleBusinessEvent(type, payload) {
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
    if (!config.desktop) return;
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
})();
