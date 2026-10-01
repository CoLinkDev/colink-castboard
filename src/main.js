import { PluginLoader } from "./plugins/loader.js";
import { PluginManager } from "./plugins/manager.js";
import lyrics, { manifest as lyricsManifest } from "./plugins/builtin/lyrics/index.js";
import sysinfo, { manifest as sysinfoManifest } from "./plugins/builtin/sysinfo/index.js";
import time, { manifest as timeManifest } from "./plugins/builtin/time/index.js";

const { clearTimer, log, parseCssLength } = window.castBoardUtils;
const host = window.castBoardHost;
const plugins = new PluginManager({ host, language: host.config.language || document.documentElement.lang || "en" });
const loader = new PluginLoader(plugins);
window.pluginManager = plugins;
window.currentPageName = null;
window.cachedGap = 36;
window.cachedActiveY = innerHeight * 0.35;

function cacheLayoutMetrics() {
  const style = getComputedStyle(document.documentElement);
  window.cachedGap = parseCssLength(style.getPropertyValue("--line-gap"), 36);
  window.cachedActiveY = parseCssLength(style.getPropertyValue("--active-y"), innerHeight * 0.35);
}
window.cacheLayoutMetrics = cacheLayoutMetrics;

class NavigationManager {
  constructor(manager) {
    this.manager = manager;
    this.currentPageName = null;
    this.navigationTarget = null;
    this.navigationQueue = Promise.resolve();
    this.transientOriginalPage = null;
    this.isTransientActive = false;
    this.transientTimer = 0;
    this.transientRequestId = 0;
    this.temporaryReturnPage = null;
    this.temporaryFocusTarget = null;
    this.temporaryFocusTimer = 0;
    this.temporaryFocusRequestId = 0;
  }
  getNavigablePages() { return this.manager.getNavigablePages().map(({ manifest }) => manifest.id); }
  getStoredPage() {
    try {
      const id = localStorage.getItem("lyrics2screen.currentPage");
      return this.getNavigablePages().includes(id) ? id : "lyrics";
    } catch { return "lyrics"; }
  }
  async ensureMounted(record) {
    if (record.mounted) return true;
    if (record.failed) return false;
    if (record.mountPromise) return record.mountPromise;

    record.mountPromise = (async () => {
      const shell = document.createElement("div");
      shell.className = `page page-type-${record.manifest.type}`;
      shell.dataset.pluginId = record.manifest.id;
      shell.dataset.pluginType = record.manifest.type;
      shell.hidden = true;
      document.getElementById("app-root").appendChild(shell);
      return this.manager.mount(record, shell);
    })();

    try {
      return await record.mountPromise;
    } finally {
      record.mountPromise = null;
    }
  }
  async prepareTransients() {
    for (const record of this.manager.getTransientPages()) await this.ensureMounted(record);
  }
  navigateTo(id, temporary = false, direction = 0) {
    if (!temporary) {
      this.cancelTransient();
      this.cancelTemporaryFocus();
    }
    return this.queueNavigation(id, temporary, direction);
  }
  queueNavigation(id, temporary, direction, canNavigate = null) {
    this.navigationTarget = id;
    const navigation = this.navigationQueue.then(() => {
      if (canNavigate && !canNavigate()) return;
      return this.performNavigation(id, temporary, direction);
    });
    this.navigationQueue = navigation.catch((error) => {
      log("navigation", "navigation-failed", { id, error: String(error) });
    });
    return this.navigationQueue;
  }
  async performNavigation(id, temporary, direction) {
    if (id === this.currentPageName) {
      if (!temporary) this.commitCurrentPage(id, false);
      return;
    }
    const next = this.manager.get(id);
    if (!next || next.failed) return;
    const previousId = this.currentPageName;
    const previous = previousId ? this.manager.get(previousId) : null;
    if (!(await this.ensureMounted(next))) {
      if (id === "lyrics" && next.shell) {
        this.showFailedPage(next);
      } else if (id !== "lyrics") {
        void this.navigateTo("lyrics", temporary);
      }
      return;
    }
    this.clearPendingHide(next);
    if (previous) {
      this.clearPendingHide(previous);
      await this.manager.deactivate(previous);
    }
    const [enter, leave] = this.classes(previousId, id, direction);
    next.shell.hidden = false;
    next.shell.classList.remove("page-active", "page-leave-next", "page-leave-prev", "page-leave-fade", "page-enter-next", "page-enter-prev", "page-enter-fade");
    next.shell.classList.add(enter);
    void next.shell.offsetWidth;
    this.commitCurrentPage(id, temporary);
    if (!(await this.manager.activate(next))) {
      this.showFailedPage(next);
      if (previous?.shell) previous.shell.hidden = true;
      if (id !== "lyrics") void this.navigateTo("lyrics", true);
      return;
    }
    requestAnimationFrame(() => {
      if (this.currentPageName !== id) return;
      previous?.shell?.classList.remove("page-active", "page-enter-next", "page-enter-prev", "page-enter-fade");
      previous?.shell?.classList.add(leave);
      next.shell.classList.remove(enter);
      next.shell.classList.add("page-active");
    });
    if (previous?.shell) this.scheduleHide(previous, leave, previousId);
    log("navigation", "page-navigated", { from: previousId, to: id, temporary });
  }
  commitCurrentPage(id, temporary) {
    this.currentPageName = id;
    window.currentPageName = id;
    if (!temporary) try { localStorage.setItem("lyrics2screen.currentPage", id); } catch {}
    updateIndicator(id);
  }
  showFailedPage(record) {
    this.clearPendingHide(record);
    record.shell.hidden = false;
    record.shell.classList.remove("page-enter-next", "page-enter-prev", "page-enter-fade");
    record.shell.classList.add("page-active");
    this.commitCurrentPage(record.manifest.id, true);
  }
  clearPendingHide(record) {
    record.cancelPendingHide?.();
    record.cancelPendingHide = null;
    record.shell?.classList.remove(
      "page-enter-next", "page-enter-prev", "page-enter-fade",
      "page-leave-next", "page-leave-prev", "page-leave-fade",
    );
  }
  scheduleHide(record, leaveClass, id) {
    const shell = record.shell;
    let timeoutId = 0;
    const finish = (event) => {
      if (event && (event.target !== shell || event.propertyName !== "transform")) return;
      shell.removeEventListener("transitionend", finish);
      clearTimeout(timeoutId);
      shell.classList.remove(leaveClass);
      if (this.currentPageName !== id) shell.hidden = true;
      record.cancelPendingHide = null;
    };
    record.cancelPendingHide = () => {
      shell.removeEventListener("transitionend", finish);
      clearTimeout(timeoutId);
      shell.classList.remove(leaveClass);
    };
    shell.addEventListener("transitionend", finish);
    timeoutId = setTimeout(finish, 600);
  }
  classes(from, to, direction) {
    if (direction > 0) return ["page-enter-next", "page-leave-next"];
    if (direction < 0) return ["page-enter-prev", "page-leave-prev"];
    const ids = this.getNavigablePages();
    const a = ids.indexOf(from), b = ids.indexOf(to);
    if (a >= 0 && b > a) return ["page-enter-next", "page-leave-next"];
    if (b >= 0 && b < a) return ["page-enter-prev", "page-leave-prev"];
    return ["page-enter-fade", "page-leave-fade"];
  }
  move(direction) {
    const ids = this.getNavigablePages();
    if (!ids.length) return;
    const current = this.isTransientActive
      ? this.transientOriginalPage
      : (this.navigationTarget || this.currentPageName);
    const index = Math.max(0, ids.indexOf(current));
    void this.navigateTo(ids[(index + direction + ids.length) % ids.length], false, direction);
  }
  nextPage() { this.move(1); }
  prevPage() { this.move(-1); }
  showTransient(id, durationMs) {
    const duration = this.normalizeDuration(durationMs);
    if (!this.manager.getTransientPages().some(({ manifest }) => manifest.id === id) || !this.currentPageName) return;
    if (!this.isTransientActive) this.transientOriginalPage = this.currentPageName;
    this.isTransientActive = true;
    clearTimeout(this.transientTimer);
    const requestId = ++this.transientRequestId;
    void this.queueNavigation(
      id,
      true,
      0,
      () => requestId === this.transientRequestId && this.isTransientActive,
    ).then(() => {
      if (requestId !== this.transientRequestId || !this.isTransientActive) return;
      if (this.currentPageName !== id) {
        this.cancelTransient();
        return;
      }
      this.transientTimer = setTimeout(() => this.restoreTransient(), duration);
    });
  }
  restoreTransient() {
    clearTimeout(this.transientTimer);
    this.transientTimer = 0;
    const requestId = ++this.transientRequestId;
    const target = this.transientOriginalPage || "lyrics";
    this.isTransientActive = false;
    this.transientOriginalPage = null;
    void this.queueNavigation(
      target,
      true,
      0,
      () => requestId === this.transientRequestId,
    );
  }
  cancelTransient() {
    clearTimeout(this.transientTimer);
    this.transientTimer = 0;
    this.transientRequestId += 1;
    this.isTransientActive = false;
    this.transientOriginalPage = null;
  }
  requestTemporaryFocus(id, durationMs) {
    const duration = this.normalizeDuration(durationMs);
    const navigablePages = this.getNavigablePages();
    if (!navigablePages.includes(id) || !this.currentPageName) return Promise.resolve(false);
    if (this.currentPageName === id || this.navigationTarget === id) return Promise.resolve(false);

    const returnPage = this.temporaryReturnPage
      || (this.isTransientActive ? this.transientOriginalPage : this.currentPageName);
    if (!navigablePages.includes(returnPage)) return Promise.resolve(false);

    if (this.isTransientActive) this.cancelTransient();
    this.cancelTemporaryFocus();
    this.temporaryReturnPage = returnPage;
    this.temporaryFocusTarget = id;
    const requestId = ++this.temporaryFocusRequestId;

    return this.queueNavigation(
      id,
      true,
      0,
      () => requestId === this.temporaryFocusRequestId && this.temporaryFocusTarget === id,
    ).then(() => {
      if (requestId !== this.temporaryFocusRequestId || this.temporaryFocusTarget !== id) return false;
      if (this.currentPageName !== id) {
        this.cancelTemporaryFocus();
        return false;
      }
      this.temporaryFocusTimer = setTimeout(() => {
        if (requestId === this.temporaryFocusRequestId) this.restoreTemporaryFocus();
      }, duration);
      return true;
    });
  }
  extendTemporaryFocus(id, durationMs) {
    const duration = this.normalizeDuration(durationMs);
    if (
      !this.temporaryReturnPage
      || this.temporaryFocusTarget !== id
      || this.currentPageName !== id
    ) {
      return false;
    }
    clearTimeout(this.temporaryFocusTimer);
    const requestId = this.temporaryFocusRequestId;
    this.temporaryFocusTimer = setTimeout(() => {
      if (requestId === this.temporaryFocusRequestId) this.restoreTemporaryFocus();
    }, duration);
    return true;
  }
  restoreTemporaryFocus() {
    const target = this.temporaryReturnPage;
    if (!target) return;
    this.cancelTemporaryFocus();
    if (this.isTransientActive) {
      this.transientOriginalPage = target;
      return;
    }
    const requestId = this.temporaryFocusRequestId;
    void this.queueNavigation(
      target,
      true,
      0,
      () => requestId === this.temporaryFocusRequestId,
    );
  }
  cancelTemporaryFocus() {
    clearTimeout(this.temporaryFocusTimer);
    this.temporaryFocusTimer = 0;
    this.temporaryFocusRequestId += 1;
    this.temporaryReturnPage = null;
    this.temporaryFocusTarget = null;
  }
  normalizeDuration(durationMs) {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("Navigation duration must be a non-negative finite number");
    }
    return duration;
  }
}
window.navManager = new NavigationManager(plugins);

const icons = {
  previous: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
};
let indicator, indicatorTimer = 0, menu, pointer, dragged = false, indicatorWasVisible = false, resizeTimer = 0;

function createIndicator() {
  indicator ||= document.body.appendChild(Object.assign(document.createElement("div"), { id: "page-indicator", className: "page-indicator" }));
  indicator.replaceChildren();
  const controls = Object.assign(document.createElement("div"), { className: "media-controls-row" });
  const labels = window.castBoardI18n.messages("controls");
  for (const action of ["previous", "playPause", "next"]) {
    const button = Object.assign(document.createElement("button"), { className: "media-control-btn", type: "button" });
    button.dataset.action = action;
    button.setAttribute("aria-label", labels[action]);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const command = action === "playPause" ? (button.dataset.paused === "true" ? "play" : "pause") : action;
      if (action === "playPause") updatePlayPause(command === "pause");
      host.sendMediaControl(command).catch((error) => {
        if (action === "playPause") updatePlayPause(window.progressPaused);
        log("app", "send-media-control-failed", { command, error: String(error) });
      });
      showIndicator();
    });
    controls.appendChild(button);
  }
  indicator.appendChild(controls);
  const pages = plugins.getNavigablePages();
  if (pages.length > 1) {
    const dots = Object.assign(document.createElement("div"), { className: "page-indicator-dots" });
    for (const { manifest } of pages) {
      const dot = Object.assign(document.createElement("button"), { className: "page-indicator-dot", type: "button" });
      dot.dataset.page = manifest.id;
      dot.setAttribute("aria-label", manifest.name[host.config.language] || manifest.name.en || manifest.id);
      dot.addEventListener("click", (event) => { event.stopPropagation(); void window.navManager.navigateTo(manifest.id); showIndicator(); });
      dots.appendChild(dot);
    }
    indicator.appendChild(dots);
  }
  updatePlayPause(window.progressPaused);
  updateIndicator(window.currentPageName || "lyrics");
}
function updatePlayPause(paused) {
  const button = indicator?.querySelector('[data-action="playPause"]');
  if (!button) return;
  button.dataset.paused = paused ? "true" : "false";
  button.innerHTML = paused ? icons.play : icons.pause;
  for (const action of ["previous", "next"]) indicator.querySelector(`[data-action="${action}"]`).innerHTML = icons[action];
}
function updateIndicator(id) {
  if (!indicator) return;
  if (plugins.get(id)?.manifest.type === "transient") { hideIndicator(); return; }
  for (const dot of indicator.querySelectorAll(".page-indicator-dot")) dot.classList.toggle("active", dot.dataset.page === id);
  const expanded = id === "lyrics" && host.featureGates.mediaControl;
  indicator.classList.toggle("expanded", expanded);
  indicator.style.display = indicator.querySelectorAll(".page-indicator-dot").length > 1 || expanded ? "flex" : "none";
}
function showIndicator() {
  if (!indicator || plugins.get(window.currentPageName)?.manifest.type === "transient") return;
  indicator.classList.add("visible");
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => indicator?.classList.remove("visible"), 2800);
}
function hideIndicator() { clearTimeout(indicatorTimer); indicator?.classList.remove("visible"); }

function createMenu() {
  const labels = window.castBoardI18n.messages("contextMenu");
  menu = Object.assign(document.createElement("div"), { className: "castboard-context-menu", hidden: true });
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button class="castboard-context-menu-item" type="button" data-action="close" role="menuitem">${labels.close}</button>${host.config.debug ? `<button class="castboard-context-menu-item" type="button" data-action="open-devtools" role="menuitem">${labels.openDevTools}</button>` : ""}`;
  menu.addEventListener("click", (event) => {
    event.stopPropagation(); menu.hidden = true;
    const action = event.target.closest("[data-action]")?.dataset.action;
    const request = action === "close" ? host.close() : action === "open-devtools" ? host.openDevTools() : null;
    request?.catch((error) => log("app", "context-menu-action-failed", { action, error: String(error) }));
  });
  document.body.appendChild(menu);
}

function bindEvents() {
  createMenu(); createIndicator();
  plugins.addEventListener("changed", (event) => {
    createIndicator();
    const record = plugins.get(event.detail.id);
    if (record?.manifest.type === "transient") {
      void window.navManager.ensureMounted(record).catch((error) => {
        log("plugin", "transient-mount-failed", { id: record.manifest.id, error: String(error) });
      });
    }
  });
  plugins.addEventListener("failed", (event) => {
    createIndicator();
    if (event.detail.hook === "onResize" && event.detail.id === window.currentPageName && event.detail.id !== "lyrics") {
      void window.navManager.navigateTo("lyrics");
    }
  });
  addEventListener("lyrics-progress-change", () => invokeActivePlugin("lyrics", "onProgressChange"));
  addEventListener("lyrics-lines-change", () => invokeActivePlugin("lyrics", "layoutLyrics"));
  addEventListener("playback-paused-change", () => updatePlayPause(window.progressPaused));
  addEventListener("resize", () => { resizeTimer = clearTimer(resizeTimer); resizeTimer = setTimeout(() => { cacheLayoutMetrics(); void plugins.resize({ width: innerWidth, height: innerHeight }); }, 80); });
  addEventListener("pointerdown", (event) => {
    if ((event.pointerType === "mouse" && event.button !== 0) || !event.isPrimary) return;
    if (event.composedPath().includes(indicator) || event.composedPath().includes(menu)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
    dragged = false;
    indicatorWasVisible = indicator?.classList.contains("visible");
  });
  addEventListener("pointermove", (event) => {
    if (!pointer || (pointer.id !== undefined && pointer.id !== event.pointerId)) return;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) dragged = true;
    showIndicator();
  });
  addEventListener("pointerup", (event) => {
    if (!pointer || (pointer.id !== undefined && pointer.id !== event.pointerId)) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y, elapsed = Date.now() - pointer.time;
    pointer = null;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (absX > 36 && absX > absY && elapsed < 1000) {
      dx < 0 ? window.navManager.nextPage() : window.navManager.prevPage();
      showIndicator();
    }
  });
  addEventListener("pointercancel", (event) => {
    if (!pointer || (pointer.id !== undefined && pointer.id !== event.pointerId)) return;
    const lastX = pointer.lastX ?? pointer.x, lastY = pointer.lastY ?? pointer.y;
    const dx = lastX - pointer.x, dy = lastY - pointer.y, elapsed = Date.now() - pointer.time;
    pointer = null;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (absX > 45 && absX > absY && elapsed < 1000) {
      dx < 0 ? window.navManager.nextPage() : window.navManager.prevPage();
      showIndicator();
    } else {
      dragged = false;
      indicatorWasVisible = false;
    }
  });
  addEventListener("click", (event) => {
    if (!menu.hidden) { menu.hidden = true; return; }
    if (event.composedPath().includes(indicator) || event.composedPath().includes(menu)) return;
    if (event.composedPath().some(el => el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute?.("role") === "button")) return;
    if (window.navManager.isTransientActive) { window.navManager.restoreTransient(); return; }
    if (dragged) { dragged = false; return; }
    indicatorWasVisible ? hideIndicator() : showIndicator();
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") menu.hidden = true;
    if (event.key === "ArrowLeft") window.navManager.prevPage();
    if (event.key === "ArrowRight") window.navManager.nextPage();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") showIndicator();
  });
  addEventListener("contextmenu", (event) => { event.preventDefault(); if (event.button !== 2) return; menu.hidden = false; menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`; menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`; });
  addEventListener("wheel", (event) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); }, { passive: false });
  addEventListener("beforeunload", () => { host.stopMusicAlive(); host.stopSysInfoAlive(); for (const record of plugins.plugins.values()) void plugins.unmount(record); });
}

function invokeActivePlugin(id, method) {
  const record = plugins.get(id);
  if (record?.active) record.plugin[method]?.();
}

async function boot() {
  plugins.registerBuiltin(lyricsManifest, lyrics, new URL("./plugins/builtin/lyrics/index.js", import.meta.url));
  if (host.featureGates.sysinfoBasic) plugins.registerBuiltin(sysinfoManifest, sysinfo, new URL("./plugins/builtin/sysinfo/index.js", import.meta.url));
  plugins.registerBuiltin(timeManifest, time, new URL("./plugins/builtin/time/index.js", import.meta.url));
  bindEvents(); cacheLayoutMetrics();
  host.on("plugins.register", (payload) => {
    loader.loadRegistration(payload).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") log("plugin", "external-load-failed", { error: String(result.reason) });
      }
    });
  });
  await (document.fonts?.ready ?? Promise.resolve());
  await window.navManager.navigateTo(window.navManager.getStoredPage());
  await window.navManager.ensureMounted(plugins.get("lyrics"));
  await window.navManager.prepareTransients();
  host.notifyPageReady().then(() => host.startMusicAlive()).catch((error) => log("app", "page-ready-request-failed", { error: String(error) }));
  loader.loadDevelopmentPlugins().then((results) => results.filter(({ status }) => status === "rejected").forEach(({ reason }) => log("plugin", "development-load-failed", { error: String(reason) }))).catch((error) => log("plugin", "development-index-failed", { error: String(error) }));
}
void boot().catch((error) => log("app", "boot-failed", { error: String(error) }));
