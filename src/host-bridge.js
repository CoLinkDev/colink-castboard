// CastBoard's only boundary to its native hosts and external protocol data.
(() => {
  const { compareSemver, formatDuration } = window.castBoardUtils;
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
    sysinfoNetDisk: compareSemver(peerBusinessVersion, "1.2.0") >= 0,
  });
  const handlers = {};

  function registerHandlers(nextHandlers) {
    Object.assign(handlers, nextHandlers);
  }

  function dispatchMusicEvent(event, payload) {
    handlers.onMusicEvent?.(event, payload);
  }

  function dispatchSysInfoStats(payload) {
    handlers.onSysInfoStats?.(payload);
  }

  function handleBusinessEvent(type, payload) {
    switch (type) {
      case "music.v1.track":
        dispatchMusicEvent("Track", protocolTrackToLegacy(payload));
        break;
      case "music.v1.lyric":
        dispatchMusicEvent("Lyric", protocolLyricToLegacy(payload));
        break;
      case "music.v1.progress":
        dispatchMusicEvent("PlayerProgress", {
          progress: Number(payload?.progress || 0),
          paused: payload?.paused !== false,
        });
        break;
      case "sysinfo.v1.stats":
        if (featureGates.sysinfoBasic) {
          dispatchSysInfoStats({
            cpu: payload?.cpu,
            mem: payload?.mem,
            gpu: payload?.gpu,
            netUp: featureGates.sysinfoNetDisk ? (payload?.net_up ?? payload?.netUp) : undefined,
            netDown: featureGates.sysinfoNetDisk ? (payload?.net_down ?? payload?.netDown) : undefined,
            diskRead: featureGates.sysinfoNetDisk ? (payload?.disk_read ?? payload?.diskRead) : undefined,
            diskWrite: featureGates.sysinfoNetDisk ? (payload?.disk_write ?? payload?.diskWrite) : undefined,
          });
        }
        break;
    }
  }

  function protocolTrackToLegacy(payload) {
    if (!payload || !payload.trackId) {
      return {
        title: "",
        author: "",
        album: "",
        source: "",
        cover: "",
        duration: 0,
        durationHuman: "0:00",
      };
    }

    const durationMs = Number(payload.duration || 0);
    return {
      title: payload.title || "",
      author: Array.isArray(payload.artists) ? payload.artists.join(", ") : "",
      album: payload.album || "",
      source: payload.source || "",
      cover: payload.coverData ? `data:image/png;base64,${payload.coverData}` : payload.coverUrl || "",
      duration: Math.floor(durationMs / 1000),
      durationHuman: formatDuration(durationMs),
      id: payload.trackId,
    };
  }

  function protocolLyricToLegacy(payload) {
    const convertLine = (line) => ({
      time: Number(line.time || 0) / 1000,
      text: typeof line.text === "string" ? line.text : "",
    });
    return {
      lines: Array.isArray(payload?.lines) ? payload.lines.map(convertLine) : [],
      translatedLines: Array.isArray(payload?.translatedLines) ? payload.translatedLines.map(convertLine) : [],
    };
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
  window.handleMusicEvent = dispatchMusicEvent;
  window.handleCoLinkBusinessEvent = handleBusinessEvent;
  window.handleSysInfoStats = dispatchSysInfoStats;

  if (language) {
    document.documentElement.setAttribute("lang", language);
  }
})();
