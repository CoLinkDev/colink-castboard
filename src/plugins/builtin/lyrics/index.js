async function loadTemplate() {
  const response = await fetch(new URL("./template.html", import.meta.url));
  if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
  return response.text();
}
const { clampUnit, formatSeconds } = window.castBoardUtils;
const TEMPORARY_FOCUS_DURATION_MS = 5000;

        let stage = null;
        let active = false;
        let removeTrackChangeListener = null;
        let ambientLayers = [];
        let ambientActiveIndex = 0;
        let ambientCoverUrl = "";
        let playbackTime = null;
        let elapsedMinEl = null;
        let elapsedSecTensEl = null;
        let elapsedSecOnesEl = null;
        let playbackProgress = null;
        let progressFill = null;
        let lastElapsedSecond = -1;
        let trackInfo = null;
        let trackInfoSourceIcon = null;
        let trackInfoTitle = null;
        let trackInfoAuthor = null;
        let trackInfoWrapper = null;
        let trackInfoText = null;
        let trackInfoSeparator = null;
        let marqueeTimeoutId = null;
        let marqueeAnimation = null;
        let marqueeWrapperAnimation = null;

        const OPACITY_TABLE = [1, 0.40, 0.25, 0.10, 0.04];
        const BLUR_TABLE = [0, 2.7, 3.9, 5.1, 6.3];
        const VISIBLE_BEFORE = 3;
        const VISIBLE_AFTER = 5;
        const LYRIC_TRANSITION_MS = 1260;
        const LYRIC_TRANSITION = "transform 1180ms var(--ease), opacity 980ms var(--ease)";

        const lineElements = new Map();
        let currentIndex = 0;
        let lastRenderedIndex = null;
        const heightCache = new Map();
        const SOURCE_ICONS = {
          ncm: "icons/neteasecloudmusic.svg",
          qqmusic: "icons/qqmusic.svg",
          applemusic: "icons/applemusic.svg",
          spotify: "icons/spotify.svg",
          ytmusic: "icons/youtubemusic.svg",
          bilibili: "icons/bilibili.svg",
          tidal: "icons/tidal.svg",
          deezer: "icons/deezer.svg",
          kugou: "icons/kugou.svg",
        };
        function noLyricsLabel() {
          return window.castBoardI18n.t("lyrics.noLyrics");
        }

        function stopMarquee() {
          if (marqueeTimeoutId) {
            clearTimeout(marqueeTimeoutId);
            marqueeTimeoutId = null;
          }
          if (marqueeAnimation) {
            marqueeAnimation.cancel();
            marqueeAnimation = null;
          }
          if (marqueeWrapperAnimation) {
            marqueeWrapperAnimation.cancel();
            marqueeWrapperAnimation = null;
          }
        }

        function resetLyricsDom() {
          if (stage) stage.replaceChildren();
          lineElements.clear();
          heightCache.clear();
          lastRenderedIndex = null;
        }

        function renderEmptyLyrics() {
          resetLyricsDom();
          if (!stage) return;

          const activeY = window.cachedActiveY;
          const empty = document.createElement("p");
          empty.className = "line is-current empty-lyrics";
          empty.textContent = noLyricsLabel();
          if (Number.isFinite(activeY)) {
            empty.style.transform = `translate3d(0, ${activeY}px, 0) scale(1.08)`;
          }
          empty.style.opacity = "1";
          empty.style.visibility = "visible";
          stage.appendChild(empty);
        }

        function visibleRangeFor(activeIndex) {
          return [
            Math.max(0, activeIndex - VISIBLE_BEFORE),
            Math.min(window.LYRICS.length - 1, activeIndex + VISIBLE_AFTER),
          ];
        }

        function offsetsForVisibleRange(start, end, activeIndex, heights) {
          const offsets = new Map([[activeIndex, 0]]);
          const gap = window.cachedGap;
          let offset = 0;
          for (let i = activeIndex + 1; i <= end; i += 1) {
            offset += (heights.get(i - 1) ?? 0) + gap;
            offsets.set(i, offset);
          }
          offset = 0;
          for (let i = activeIndex - 1; i >= start; i -= 1) {
            offset -= gap + (heights.get(i) ?? 0);
            offsets.set(i, offset);
          }
          return offsets;
        }

        function renderLyrics() {
          if (!stage) return;
          if (window.LYRICS.length === 0) {
            renderEmptyLyrics();
            if (stage) stage.classList.remove("is-ready");
            return;
          }

          const active = currentIndex;
          const diff = lastRenderedIndex !== null ? Math.abs(active - lastRenderedIndex) : 0;
          const shouldAnimate = lastRenderedIndex !== null && diff >= 1 && diff <= 2;
          const activeY = window.cachedActiveY;
          const [start, end] = visibleRangeFor(active);
          const offsets = offsetsForVisibleRange(start, end, active, heightCache);

          for (const [index, line] of lineElements) {
            const isVisible = index >= start && index <= end;
            if (!isVisible) {
              if (line._wasVisible !== false) {
                line.style.visibility = "hidden";
                line.style.opacity = "0";
                line.style.transition = "none";
                line.style.filter = "none";
                line._activeTransition = "none";
                line._wasVisible = false;
              }
              continue;
            }

            line.style.visibility = "visible";

            const distance = index - active;
            const absDistance = Math.abs(distance);
            const offset = offsets.get(index) ?? 0;
            const translateY = activeY + offset;
            const scale = Math.max(0.84, 1.08 - absDistance * 0.075);
            const opacity = OPACITY_TABLE[absDistance] ?? 0;
            const blur = BLUR_TABLE[absDistance] ?? 0;

            const targetTransition = shouldAnimate && line._wasVisible ? LYRIC_TRANSITION : "none";
            if (line._activeTransition !== targetTransition) {
              line.style.transition = targetTransition;
              line._activeTransition = targetTransition;
            }

            line.classList.toggle("is-current", distance === 0);
            line.style.transform = `translate3d(0, ${translateY}px, 0) scale(${scale})`;
            line.style.opacity = String(opacity);
            line.style.filter = blur > 0 ? `blur(${blur}px)` : "none";
            line.style.zIndex = String(20 - absDistance);
            line._wasVisible = true;
          }

          lastRenderedIndex = active;
        }

        function layoutLyrics() {
          if (window.currentPageName && window.currentPageName !== "lyrics") return;
          if (stage) stage.classList.remove("is-ready");

          currentIndex = window.activeIndex;
          resetLyricsDom();

          if (window.LYRICS.length === 0) {
            renderEmptyLyrics();
            return;
          }

          const fragment = document.createDocumentFragment();
          for (let i = 0; i < window.LYRICS.length; i += 1) {
            const line = document.createElement("div");
            line.className = "line";
            line.dataset.index = String(i);
            line.style.opacity = "0";
            line.style.visibility = "hidden";
            line.style.transition = "none";
            line._activeTransition = "none";
            line._wasVisible = false;

            const origin = document.createElement("div");
            origin.className = "line-origin";
            origin.textContent = window.LYRICS[i].text;
            line.appendChild(origin);

            if (window.LYRICS[i].translation) {
              const translation = document.createElement("div");
              translation.className = "line-translation";
              translation.textContent = window.LYRICS[i].translation;
              line.appendChild(translation);
            }

            fragment.appendChild(line);
            lineElements.set(i, line);
          }
          stage.appendChild(fragment);

          for (let i = 0; i < window.LYRICS.length; i += 1) {
            const line = lineElements.get(i);
            heightCache.set(i, line.offsetHeight);
          }

          renderLyrics();

          if (lineElements.size > 0 && stage) {
            stage.classList.add("is-ready");
          }
        }

        function updateMarquee() {
          stopMarquee();

          if (!trackInfoWrapper || !trackInfoText) return;

          // Reset transform before measuring and remove marquee class
          trackInfoText.style.transform = "none";
          trackInfoWrapper.classList.remove("is-marquee");

          const overflowDistance = trackInfoText.scrollWidth - trackInfoWrapper.clientWidth;
          if (overflowDistance <= 0) {
            return;
          }

          trackInfoWrapper.classList.add("is-marquee");

          const speed = 25; // pixels per second
          const t_start_pause = 3000; // ms
          const t_scroll = (overflowDistance / speed) * 1000; // ms
          const t_end_pause = 3000; // ms
          const t_fade_out = 70; // ms
          const t_fade_in = 70; // ms
          const total_duration = t_start_pause + t_scroll + t_end_pause + t_fade_out + t_fade_in;

          const offset_start_pause = t_start_pause / total_duration;
          const offset_scroll = (t_start_pause + t_scroll) / total_duration;
          const offset_end_pause = (t_start_pause + t_scroll + t_end_pause) / total_duration;
          const offset_fade_out = (t_start_pause + t_scroll + t_end_pause + t_fade_out) / total_duration;
          const offset_reset = offset_fade_out + 0.001;

          const keyframes = [
            { offset: 0, transform: "translateX(0)", opacity: 1 },
            { offset: offset_start_pause, transform: "translateX(0)", opacity: 1 },
            { offset: offset_scroll, transform: `translateX(${-overflowDistance}px)`, opacity: 1 },
            { offset: offset_end_pause, transform: `translateX(${-overflowDistance}px)`, opacity: 1 },
            { offset: offset_fade_out, transform: `translateX(${-overflowDistance}px)`, opacity: 0 },
            { offset: offset_reset, transform: "translateX(0)", opacity: 0 },
            { offset: 1.0, transform: "translateX(0)", opacity: 1 }
          ];

          const fadeWidth = 24;
          const maxFade = Math.min(fadeWidth, overflowDistance);
          const t_edge = (maxFade / speed) * 1000; // ms
          const hasIntermediate = t_scroll > (2 * t_edge);

          const getMaskValues = (x) => {
            const left = Math.min(maxFade, x);
            const right = Math.min(maxFade, overflowDistance - x);
            return {
              left: `${left}px`,
              right: `${right}px`
            };
          };

          const wrapperKeyframes = [];

          const pushKeyframe = (time, x) => {
            const offset = time / total_duration;
            const masks = getMaskValues(x);
            wrapperKeyframes.push({
              offset: Math.min(1.0, Math.max(0.0, offset)),
              "--mask-left": masks.left,
              "--mask-right": masks.right
            });
          };

          pushKeyframe(0, 0);
          pushKeyframe(t_start_pause, 0);

          if (hasIntermediate) {
            pushKeyframe(t_start_pause + t_edge, maxFade);
            pushKeyframe(t_start_pause + t_scroll - t_edge, overflowDistance - maxFade);
          }

          pushKeyframe(t_start_pause + t_scroll, overflowDistance);
          pushKeyframe(t_start_pause + t_scroll + t_end_pause, overflowDistance);
          pushKeyframe(t_start_pause + t_scroll + t_end_pause + t_fade_out, overflowDistance);

          const masksReset = getMaskValues(0);
          wrapperKeyframes.push({
            offset: offset_reset,
            "--mask-left": masksReset.left,
            "--mask-right": masksReset.right
          });

          pushKeyframe(total_duration, 0);

          marqueeAnimation = trackInfoText.animate(keyframes, {
            duration: total_duration,
            iterations: Infinity,
            easing: "linear"
          });

          marqueeWrapperAnimation = trackInfoWrapper.animate(wrapperKeyframes, {
            duration: total_duration,
            iterations: Infinity,
            easing: "linear"
          });
        }

        function renderTrackSummary() {
          if (!trackInfo) return;
          const title = window.TRACK_INFO.title;
          const author = window.TRACK_INFO.author;
          const sourceIcon = SOURCE_ICONS[window.TRACK_INFO.source] || "";
          const hasInfo = title !== "" || author !== "";

          trackInfo.hidden = !hasInfo;
          trackInfoSourceIcon.hidden = sourceIcon === "";
          if (sourceIcon && trackInfoSourceIcon.src !== sourceIcon) {
            trackInfoSourceIcon.src = sourceIcon;
          }
          trackInfoTitle.hidden = title === "";
          trackInfoAuthor.hidden = author === "";
          if (trackInfoSeparator) {
            trackInfoSeparator.hidden = title === "" || author === "";
          }
          trackInfoTitle.textContent = title;
          trackInfoAuthor.textContent = author;

          if (marqueeTimeoutId) clearTimeout(marqueeTimeoutId);
          marqueeTimeoutId = setTimeout(updateMarquee, 50);
        }

        function setAmbientCover(url) {
          if (url === ambientCoverUrl) return;
          ambientCoverUrl = url;

          if (url === "") {
            for (const layer of ambientLayers) {
              layer.classList.remove("is-active");
            }
            return;
          }

          const preloader = new Image();
          preloader.onload = () => {
            if (ambientCoverUrl !== url) return;
            const nextIndex = 1 - ambientActiveIndex;
            const nextLayer = ambientLayers[nextIndex];
            const currentLayer = ambientLayers[ambientActiveIndex];
            if (!nextLayer) return;
            nextLayer.style.backgroundImage = `url("${url}")`;
            nextLayer.classList.add("is-active");
            if (currentLayer) currentLayer.classList.remove("is-active");
            ambientActiveIndex = nextIndex;
          };
          preloader.onerror = () => {
            if (ambientCoverUrl !== url) return;
            for (const layer of ambientLayers) {
              layer.classList.remove("is-active");
            }
          };
          preloader.src = url;
        }

        function splitTime(totalSeconds) {
          const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
          const total = Math.floor(safe);
          const minutes = Math.floor(total / 60);
          const seconds = total % 60;
          return {
            min: String(minutes),
            secTens: String(Math.floor(seconds / 10)),
            secOnes: String(seconds % 10),
          };
        }

        function updateSlot(slot, nextVal, shouldAnimate) {
          if (!slot) return;
          const currentVal = slot.dataset.val ?? slot.textContent;
          if (currentVal === nextVal && slot.children.length === 0) return;

          slot.dataset.val = nextVal;

          if (!shouldAnimate || currentVal === nextVal) {
            slot.textContent = nextVal;
            return;
          }

          const oldSpan = document.createElement("span");
          oldSpan.className = "time-roll-out";
          oldSpan.textContent = currentVal;

          const newSpan = document.createElement("span");
          newSpan.className = "time-roll-in";
          newSpan.textContent = nextVal;

          slot.replaceChildren(oldSpan, newSpan);

          setTimeout(() => {
            if (slot.dataset.val === nextVal) {
              slot.textContent = nextVal;
            }
          }, 520);
        }

        function renderProgress() {
          if (!progressFill) return;
          const elapsed = Math.max(0, Number(window.progressPosition) || 0);
          const durationSeconds = Number.isFinite(window.duration) && window.duration > 0 ? window.duration : 0;
          const progress = durationSeconds > 0 ? clampUnit(elapsed / durationSeconds) : 0;

          const elapsedSec = Math.floor(elapsed);
          if (elapsedSec !== lastElapsedSecond) {
            const isNormalStep = lastElapsedSecond !== -1 && Math.abs(elapsedSec - lastElapsedSecond) === 1;
            progressFill.style.transition = isNormalStep ? "transform 1s linear" : "none";
            lastElapsedSecond = elapsedSec;
            progressFill.style.transform = `scaleX(${progress})`;

            const elTime = splitTime(elapsed);
            updateSlot(elapsedMinEl, elTime.min, isNormalStep);
            updateSlot(elapsedSecTensEl, elTime.secTens, isNormalStep);
            updateSlot(elapsedSecOnesEl, elTime.secOnes, isNormalStep);
          }
        }

        function renderPlaybackMeta() {
          const hasTrack = window.TRACK_INFO.title !== "" || window.TRACK_INFO.author !== "" || Number(window.duration) > 0;
          if (playbackTime) {
            playbackTime.hidden = !hasTrack;
          }
          if (playbackProgress) {
            playbackProgress.hidden = !hasTrack;
          }

          setAmbientCover(window.TRACK_INFO.cover || "");
          renderProgress();
        }

        const plugin = {
          async mount(shadowRoot, context) {
            const template = await loadTemplate();
            shadowRoot.innerHTML = template;
            const container = shadowRoot;
            stage = container.querySelector(".stage");
            ambientLayers = Array.from(container.querySelectorAll(".ambient-cover"));
            ambientActiveIndex = 0;
            ambientCoverUrl = "";
            playbackTime = container.querySelector(".playback-time");
            elapsedMinEl = container.querySelector(".time-elapsed-min");
            elapsedSecTensEl = container.querySelector(".time-elapsed-sec-tens");
            elapsedSecOnesEl = container.querySelector(".time-elapsed-sec-ones");
            playbackProgress = container.querySelector(".playback-progress");
            progressFill = container.querySelector(".playback-progress-fill");
            lastElapsedSecond = -1;
            trackInfo = container.querySelector(".track-info");
            trackInfoSourceIcon = container.querySelector(".track-info-source-icon");
            trackInfoTitle = container.querySelector(".track-info-title");
            trackInfoAuthor = container.querySelector(".track-info-author");
            trackInfoWrapper = container.querySelector(".track-info-wrapper");
            trackInfoText = container.querySelector(".track-info-text");
            trackInfoSeparator = container.querySelector(".track-info-separator");

            if (typeof window.cacheLayoutMetrics === "function") {
              window.cacheLayoutMetrics();
            }

            resetLyricsDom();
            renderTrackSummary();
            renderPlaybackMeta();
            layoutLyrics();

            const handleTrackChange = () => {
              if (active) {
                plugin.onTrackChange();
                context.navigation.extendTemporaryFocus?.(TEMPORARY_FOCUS_DURATION_MS);
              } else {
                void context.navigation.requestTemporaryFocus(TEMPORARY_FOCUS_DURATION_MS);
              }
            };
            window.addEventListener("lyrics-track-change", handleTrackChange);
            removeTrackChangeListener = () => window.removeEventListener("lyrics-track-change", handleTrackChange);
          },
          activate() {
            active = true;
            renderTrackSummary();
            renderPlaybackMeta();
            layoutLyrics();
          },
          deactivate() {
            active = false;
            stopMarquee();
          },
          unmount() {
            active = false;
            removeTrackChangeListener?.();
            removeTrackChangeListener = null;
            stopMarquee();
            resetLyricsDom();
            stage = null;
            ambientLayers = [];
            ambientActiveIndex = 0;
            ambientCoverUrl = "";
            playbackTime = null;
            elapsedMinEl = null;
            elapsedSecTensEl = null;
            elapsedSecOnesEl = null;
            playbackProgress = null;
            progressFill = null;
            lastElapsedSecond = -1;
            trackInfo = null;
            trackInfoSourceIcon = null;
            trackInfoTitle = null;
            trackInfoAuthor = null;
            trackInfoWrapper = null;
            trackInfoText = null;
            trackInfoSeparator = null;
          },
          onTrackChange() {
            lastElapsedSecond = -1;
            renderTrackSummary();
            renderPlaybackMeta();
          },
          onProgressChange() {
            renderProgress();
            const nextIndex = window.activeIndex;
            if (nextIndex !== currentIndex) {
              currentIndex = nextIndex;
              renderLyrics();
            }
          },
          onResize() {
            heightCache.clear();
            for (const [index, line] of lineElements) {
              heightCache.set(index, line.offsetHeight);
            }
            renderLyrics();
            updateMarquee();
          },
          layoutLyrics() {
            layoutLyrics();
          }
        };
export const manifest = Object.freeze({
  schemaVersion: "1.0.0",
  id: "lyrics",
  name: {
    en: "Lyrics",
    "zh-CN": "歌词",
    ja: "歌詞",
    ko: "가사",
    "zh-TW": "歌詞",
    de: "Liedtexte",
    es: "Letras",
    ru: "Текст песни",
  },
  description: {
    en: "Displays synchronized lyrics and current track information.",
    "zh-CN": "显示同步歌词和当前曲目信息。",
    ja: "同期された歌詞と現在のトラック情報を表示します。",
    ko: "동기화된 가사와 현재 트랙 정보를 표시합니다.",
    "zh-TW": "顯示同步歌詞和目前曲目資訊。",
    de: "Zeigt synchronisierte Liedtexte und Informationen zum aktuellen Titel an.",
    es: "Muestra letras sincronizadas e información de la pista actual.",
    ru: "Показывает синхронизированный текст и сведения о текущем треке.",
  },
  version: "1.0.0",
  minCastBoardVersion: "1.0.0",
  type: "navigable",
  entry: "index.js",
});

export default plugin;
