const LYRICS = [];
const TRACK_INFO = {
  title: "",
  author: "",
  album: "",
  source: "",
  cover: "",
  durationHuman: "",
};
let duration = 0;
let progressPosition = 0;
let activeIndex = 0;
let progressAnchorPosition = 0;
let progressAnchorTime = 0;
let progressPaused = true;
let progressTimerId = 0;

const LYRICS_LINES_CHANGE_EVENT = "lyrics-lines-change";
const LYRICS_TRACK_CHANGE_EVENT = "lyrics-track-change";
const LYRICS_PROGRESS_CHANGE_EVENT = "lyrics-progress-change";
const { formatDuration } = window.castBoardUtils;

function notifyLyricsLinesChanged() {
  window.dispatchEvent(new Event(LYRICS_LINES_CHANGE_EVENT));
}

function notifyLyricsTrackChanged() {
  window.dispatchEvent(new Event(LYRICS_TRACK_CHANGE_EVENT));
}

function notifyLyricsProgressChanged() {
  window.dispatchEvent(new Event(LYRICS_PROGRESS_CHANGE_EVENT));
}

function normalizeTrackText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clearLyricsData() {
  if (LYRICS.length === 0) {
    return false;
  }
  LYRICS.length = 0;
  activeIndex = 0;
  return true;
}

function updateTrackInfo(data) {
  if (!data) return false;

  let changed = false;
  for (const key of ["title", "author", "album", "source", "cover", "durationHuman"]) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;

    const nextValue = normalizeTrackText(data[key]);
    if (TRACK_INFO[key] !== nextValue) {
      TRACK_INFO[key] = nextValue;
      changed = true;
    }
  }

  return changed;
}

function toLyricLine(item) {
  if (!item || typeof item.time !== "number" || typeof item.text !== "string") {
    return null;
  }
  return {
    time: item.time / 1000,
    text: item.text,
  };
}

function mergeTranslatedLines(lines, translatedLines) {
  if (!lines.length) {
    return [];
  }

  const translations = new Map();
  if (Array.isArray(translatedLines)) {
    for (const line of translatedLines) {
      translations.set(line.time, line.text);
    }
  }

  return lines.map((line) => {
    const translated = translations.get(line.time) || "";
    return {
      time: line.time,
      text: line.text,
      translation: translated,
    };
  });
}

function stopProgressInterpolation() {
  if (progressTimerId) {
    clearTimeout(progressTimerId);
    progressTimerId = 0;
  }
}

function clampProgressPosition(value) {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.max(0, value);
  return duration > 0 ? Math.min(duration, normalized) : normalized;
}

function applyProgressPosition(nextPosition) {
  const clamped = clampProgressPosition(nextPosition);
  if (clamped === progressPosition) return false;

  progressPosition = clamped;

  if (LYRICS.length > 0) {
    activeIndex = _calcActiveIndex(progressPosition);
  }

  notifyLyricsProgressChanged();
  return true;
}

function tickProgressInterpolation() {
  progressTimerId = 0;
  if (progressPaused) return;

  const now = performance.now();
  const elapsed = (now - progressAnchorTime) / 1000;
  applyProgressPosition(progressAnchorPosition + elapsed);
  progressTimerId = setTimeout(tickProgressInterpolation, 500);
}

function startProgressInterpolation() {
  if (progressPaused || progressTimerId) return;
  progressTimerId = setTimeout(tickProgressInterpolation, 500);
}

function onLyric(data) {
  if (!data) return;

  const lines = Array.isArray(data.lines)
    ? data.lines.map(toLyricLine).filter(Boolean)
    : [];
  const translatedLines = Array.isArray(data.translatedLines)
    ? data.translatedLines.map(toLyricLine).filter(Boolean)
    : [];

  if (lines.length === 0) {
    const cleared = clearLyricsData();
    if (cleared) {
      notifyLyricsLinesChanged();
    }
    return;
  }

  LYRICS.length = 0;
  for (const item of mergeTranslatedLines(lines, translatedLines)) {
    LYRICS.push(item);
  }
  activeIndex = _calcActiveIndex(progressPosition);

  notifyLyricsLinesChanged();
}

function onPlayerProgress(data) {
  if (!data || typeof data.progress !== "number") return;

  const nextPosition = data.progress / 1000;
  progressPaused = data.paused !== false;
  progressAnchorPosition = clampProgressPosition(nextPosition);
  progressAnchorTime = performance.now();

  applyProgressPosition(progressAnchorPosition);
  if (progressPaused) {
    stopProgressInterpolation();
  } else {
    startProgressInterpolation();
  }
}

function onTrack(payload) {
  const track = toDisplayTrack(payload);
  let trackChanged = updateTrackInfo(track ?? emptyTrack());
  let linesChanged = false;
  let progressChanged = false;

  if (track && track.duration !== duration) {
    duration = track.duration;
    trackChanged = true;
  }

  if (!track) {
    if (duration !== 0) {
      duration = 0;
      trackChanged = true;
    }
    stopProgressInterpolation();
    progressPaused = true;
    progressAnchorPosition = 0;
    progressAnchorTime = 0;
    linesChanged = clearLyricsData();
    if (progressPosition !== 0) {
      progressPosition = 0;
      progressChanged = true;
    }
    if (activeIndex !== 0) {
      activeIndex = 0;
      progressChanged = true;
    }
  }

  if (trackChanged) notifyLyricsTrackChanged();
  if (linesChanged) notifyLyricsLinesChanged();
  if (progressChanged) notifyLyricsProgressChanged();
}

function toDisplayTrack(payload) {
  if (!payload || typeof payload.trackId !== "string" || payload.trackId.trim() === "") {
    return null;
  }

  const parsedDuration = Number(payload.duration || 0);
  const durationMilliseconds = Number.isFinite(parsedDuration) ? Math.max(0, parsedDuration) : 0;
  return {
    title: payload.title || "",
    author: Array.isArray(payload.artists) ? payload.artists.join(", ") : "",
    album: payload.album || "",
    source: payload.source || "",
    cover: payload.coverData ? `data:image/png;base64,${payload.coverData}` : payload.coverUrl || "",
    duration: Math.max(0, Math.floor(durationMilliseconds / 1000)),
    durationHuman: formatDuration(durationMilliseconds),
  };
}

function emptyTrack() {
  return {
    title: "",
    author: "",
    album: "",
    source: "",
    cover: "",
    durationHuman: "0:00",
  };
}

window.addEventListener("beforeunload", stopProgressInterpolation);

function handleMusicBusinessEvent(type, payload) {
  switch (type) {
    case "music.v1.lyric":
      onLyric(payload);
      break;
    case "music.v1.progress":
      onPlayerProgress(payload);
      break;
    case "music.v1.track":
      onTrack(payload);
      break;
  }
}

window.castBoardHost.registerHandlers({ onMusicBusinessEvent: handleMusicBusinessEvent });

function _calcActiveIndex(t) {
  if (LYRICS.length === 0 || !Number.isFinite(t)) return 0;
  let low = 0;
  let high = LYRICS.length - 1;
  let active = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (t >= LYRICS[mid].time) {
      active = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return active;
}

window.LYRICS = LYRICS;
window.TRACK_INFO = TRACK_INFO;

Object.defineProperty(window, "duration", {
  get() { return duration; },
  set(v) { duration = v; },
  configurable: true,
  enumerable: true
});

Object.defineProperty(window, "progressPosition", {
  get() { return progressPosition; },
  set(v) { progressPosition = v; },
  configurable: true,
  enumerable: true
});

Object.defineProperty(window, "activeIndex", {
  get() { return activeIndex; },
  set(v) { activeIndex = v; },
  configurable: true,
  enumerable: true
});
