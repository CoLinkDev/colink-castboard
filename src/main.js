// ==== Global Config & Public State ====
window.pages = {};
window.currentPageName = null;
window.cachedGap = 36;
window.cachedActiveY = window.innerHeight * 0.35;
window.resizeTimer = 0;
window.navManager = null;
window.latestSysInfoStats = null;
let bootLocked = true;
let contextMenu = null;
function cacheLayoutMetrics() {
  const root = getComputedStyle(document.documentElement);
  cachedGap = parseCssLength(root.getPropertyValue("--line-gap"), 36);
  cachedActiveY = parseCssLength(root.getPropertyValue("--active-y"), window.innerHeight * 0.35);

  const clamped = window.innerWidth * 0.31;
  const maxByHeight = window.innerHeight * 0.88;
  const artSize = Math.min(clamped, maxByHeight);
  document.documentElement.style.setProperty("--detail-art-size", artSize + "px");
}

function isDesktopCastBoard() {
  return window.castBoardHost.config.desktop;
}

function isDesktopDevBuild() {
  return window.castBoardHost.config.devtools;
}

function hideContextMenu() {
  if (!contextMenu || contextMenu.hidden) return false;
  contextMenu.hidden = true;
  return true;
}

function createContextMenu() {
  if (!isDesktopCastBoard()) return;

  const labels = window.castBoardI18n.messages("contextMenu");
  contextMenu = document.createElement("div");
  contextMenu.className = "castboard-context-menu";
  contextMenu.hidden = true;
  contextMenu.setAttribute("role", "menu");
  contextMenu.innerHTML = `<button class="castboard-context-menu-item" type="button" data-action="close" role="menuitem">${labels.close}</button>${isDesktopDevBuild() ? `<button class="castboard-context-menu-item" type="button" data-action="open-devtools" role="menuitem">${labels.openDevTools}</button>` : ""}`;
  contextMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    hideContextMenu();
    window.castBoardHost.requestDesktopAction(action);
  });
  document.body.appendChild(contextMenu);
}

let pageIndicatorEl = null;
let pageIndicatorTimer = 0;

function createPageIndicator() {
  if (document.getElementById("page-indicator")) return;

  pageIndicatorEl = document.createElement("div");
  pageIndicatorEl.id = "page-indicator";
  pageIndicatorEl.className = "page-indicator";
  pageIndicatorEl.setAttribute("aria-label", "Page Indicator");

  const pageItems = [
    { name: "lyrics", label: "Lyrics" },
    { name: "detail", label: "Detail" },
    { name: "sysinfo", label: "System Info" },
  ];

  for (const item of pageItems) {
    const dot = document.createElement("button");
    dot.className = "page-indicator-dot";
    dot.dataset.page = item.name;
    dot.type = "button";
    dot.setAttribute("aria-label", item.label);
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.navManager) {
        window.navManager.navigateTo(item.name);
        showIndicatorTemporarily();
      }
    });
    pageIndicatorEl.appendChild(dot);
  }

  document.body.appendChild(pageIndicatorEl);
  updatePageIndicatorState(window.currentPageName || "lyrics");
}

function updatePageIndicatorState(activePageName) {
  if (!pageIndicatorEl) return;
  pageIndicatorEl.style.display = "flex";

  const dots = pageIndicatorEl.querySelectorAll(".page-indicator-dot");
  for (const dot of dots) {
    dot.classList.toggle("active", dot.dataset.page === activePageName);
  }
}

function showIndicatorTemporarily(durationMs = 2800) {
  if (!pageIndicatorEl) return;

  pageIndicatorEl.classList.add("visible");
  if (pageIndicatorTimer) {
    clearTimeout(pageIndicatorTimer);
    pageIndicatorTimer = 0;
  }

  pageIndicatorTimer = setTimeout(() => {
    pageIndicatorTimer = 0;
    if (pageIndicatorEl) {
      pageIndicatorEl.classList.remove("visible");
    }
  }, durationMs);
}

// ==== Routing and Navigation Management ====
class NavigationManager {
  constructor(pages) {
    this.pages = pages;
    this.currentPageName = null;
    this.pageCleanupTimer = 0;
    this.storageKey = "lyrics2screen.currentPage";
    this.legacyStorageKey = "lyrics2screen.detailLayerVisible";

    // Transient (temporary navigation) state
    this.transientTimer = 0;
    this.transientOriginalPage = null;
    this.isTransientActive = false;
    this.transientQueue = [];
  }

  getStoredPage() {
    try {
      const page = window.localStorage.getItem(this.storageKey);
      if (page && this.pages[page]) return page;
      const legacyDetail = window.localStorage.getItem(this.legacyStorageKey);
      if (legacyDetail === "1") return "detail";
      return "lyrics";
    } catch {
      return "lyrics";
    }
  }

  storePage(pageName) {
    try {
      window.localStorage.setItem(this.storageKey, pageName);
      window.localStorage.setItem(this.legacyStorageKey, pageName === "detail" ? "1" : "0");
    } catch {
      // Ignore if storage is unavailable
    }
  }

  navigateTo(newPageName, isTemporary = false, direction = 0) {
    if (this.currentPageName === newPageName) return;

    if (this.isTransientActive && !isTemporary) {
      this.cancelTransient();
    }

    const root = document.getElementById("app-root");
    const oldPageDoms = Array.from(root.querySelectorAll(".page"));
    const oldPageName = this.currentPageName;

    const config = this.pages[newPageName];
    if (!config) return;

    if (this.pageCleanupTimer) {
      window.clearTimeout(this.pageCleanupTimer);
      this.pageCleanupTimer = 0;
      for (const oldPageDom of oldPageDoms) {
        oldPageDom.remove();
      }
    }

    // Determine transition animation classes
    let enterClass = "page-enter-fade";
    let leaveClass = "page-leave-fade";

    if (direction > 0) {
      enterClass = "page-enter-next";
      leaveClass = "page-leave-next";
    } else if (direction < 0) {
      enterClass = "page-enter-prev";
      leaveClass = "page-leave-prev";
    } else if (oldPageName && newPageName && oldPageName !== "time" && newPageName !== "time") {
      const navigable = this.getNavigablePages();
      const fromIdx = navigable.indexOf(oldPageName);
      const toIdx = navigable.indexOf(newPageName);
      if (fromIdx !== -1 && toIdx !== -1) {
        if (toIdx > fromIdx) {
          enterClass = "page-enter-next";
          leaveClass = "page-leave-next";
        } else if (toIdx < fromIdx) {
          enterClass = "page-enter-prev";
          leaveClass = "page-leave-prev";
        }
      }
    }

    const div = document.createElement("div");
    div.innerHTML = config.template;
    const newPageDom = div.firstElementChild;

    newPageDom.classList.add(enterClass);
    root.appendChild(newPageDom);

    this.currentPageName = newPageName;
    window.currentPageName = newPageName;
    log("navigation", "page-navigated", {
      from: oldPageName,
      to: newPageName,
      temporary: isTemporary,
    });
    if (typeof updatePageIndicatorState === "function") {
      updatePageIndicatorState(newPageName);
    }
    config.mount(newPageDom);

    if (!isTemporary) {
      this.storePage(newPageName);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const oldPageDom of oldPageDoms) {
          oldPageDom.classList.remove("page-active");
          oldPageDom.classList.add(leaveClass);
        }
        newPageDom.classList.remove(enterClass);
        newPageDom.classList.add("page-active");
      });
    });

    if (oldPageDoms.length > 0) {
      let cleaned = false;
      const cleanupOldPages = () => {
        if (cleaned) return;
        cleaned = true;
        if (this.pageCleanupTimer) {
          window.clearTimeout(this.pageCleanupTimer);
          this.pageCleanupTimer = 0;
        }
        if (oldPageName && this.pages[oldPageName] && typeof this.pages[oldPageName].unmount === "function") {
          this.pages[oldPageName].unmount();
        }
        for (const oldPageDom of oldPageDoms) {
          oldPageDom.remove();
        }
      };

      const primaryOldDom = oldPageDoms[0];
      if (primaryOldDom) {
        primaryOldDom.addEventListener("transitionend", cleanupOldPages, { once: true });
      }

      this.pageCleanupTimer = window.setTimeout(cleanupOldPages, 600);
    }
  }

  getNavigablePages() {
    return window.castBoardHost.featureGates.sysinfoBasic
      ? ["lyrics", "detail", "sysinfo"]
      : ["lyrics", "detail"];
  }

  nextPage() {
    const basePage = this.isTransientActive ? (this.transientOriginalPage || "lyrics") : this.currentPageName;
    if (this.isTransientActive) {
      this.cancelTransient();
    }
    const pages = this.getNavigablePages();
    const currentIndex = pages.indexOf(basePage);
    if (currentIndex === -1) {
      this.navigateTo("lyrics", false, 1);
      return;
    }
    const nextIndex = (currentIndex + 1) % pages.length;
    this.navigateTo(pages[nextIndex], false, 1);
  }

  prevPage() {
    const basePage = this.isTransientActive ? (this.transientOriginalPage || "lyrics") : this.currentPageName;
    if (this.isTransientActive) {
      this.cancelTransient();
    }
    const pages = this.getNavigablePages();
    const currentIndex = pages.indexOf(basePage);
    if (currentIndex === -1) {
      this.navigateTo("lyrics", false, -1);
      return;
    }
    const prevIndex = (currentIndex - 1 + pages.length) % pages.length;
    this.navigateTo(pages[prevIndex], false, -1);
  }

  toggle() {
    this.nextPage();
  }

  showTransient(targetPage, durationMs) {
    if (this.isTransientActive) {
      if (this.currentPageName === targetPage) {
        // If it's already showing, just extend the timer instead of queuing a duplicate
        this.clearTransientTimer();
        this.transientTimer = window.setTimeout(() => this.restoreTransient(), durationMs);
      } else {
        // Queue up the different transient page
        this.transientQueue.push({ pageName: targetPage, durationMs });
      }
      return;
    }

    if (this.currentPageName !== targetPage) {
      this.transientOriginalPage = this.currentPageName;
      this.isTransientActive = true;
      this.navigateTo(targetPage, true);
      this.clearTransientTimer();
      this.transientTimer = window.setTimeout(() => this.restoreTransient(), durationMs);
    }
  }

  restoreTransient() {
    this.clearTransientTimer();
    if (this.transientQueue.length > 0) {
      const next = this.transientQueue.shift();
      this.navigateTo(next.pageName, true);
      this.transientTimer = window.setTimeout(() => this.restoreTransient(), next.durationMs);
    } else {
      const target = this.transientOriginalPage || "lyrics";
      if (this.currentPageName !== target) {
        this.navigateTo(target, true);
      }
      this.resetTransientState();
    }
  }

  cancelTransient() {
    this.clearTransientTimer();
    this.transientQueue = [];
    this.resetTransientState();
  }

  clearTransientTimer() {
    if (this.transientTimer) {
      window.clearTimeout(this.transientTimer);
      this.transientTimer = 0;
    }
  }

  resetTransientState() {
    this.transientOriginalPage = null;
    this.isTransientActive = false;
  }

  destroy() {
    if (this.pageCleanupTimer) {
      window.clearTimeout(this.pageCleanupTimer);
      this.pageCleanupTimer = 0;
    }
    this.cancelTransient();
  }
}

window.navManager = new NavigationManager(window.pages);

// ==== Global Event Dispatching ====
function onTrackChange() {
  if (window.navManager && !bootLocked) {
    window.navManager.showTransient("detail", 2000);
  }

  showIndicatorTemporarily(3000);

  if (pages[currentPageName] && typeof pages[currentPageName].onTrackChange === "function") {
    pages[currentPageName].onTrackChange();
  }
}

function onProgressChange() {
  if (pages[currentPageName] && typeof pages[currentPageName].onProgressChange === "function") {
    pages[currentPageName].onProgressChange();
  }
}

function applySysInfoStats(payload) {
  function normalize(value) {
    if (!Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, value));
  }

  window.latestSysInfoStats = {
    cpu: normalize(Number(payload?.cpu)),
    mem: normalize(Number(payload?.mem)),
    gpu: payload?.gpu == null ? null : normalize(Number(payload.gpu)),
    netUp: normalizeRate(payload?.net_up ?? payload?.netUp),
    netDown: normalizeRate(payload?.net_down ?? payload?.netDown),
    diskRead: normalizeRate(payload?.disk_read ?? payload?.diskRead),
    diskWrite: normalizeRate(payload?.disk_write ?? payload?.diskWrite),
  };

  window.dispatchEvent(new CustomEvent("sysinfo-stats-change", {
    detail: window.latestSysInfoStats,
  }));
}

window.castBoardHost.registerHandlers({ onSysInfoStats: applySysInfoStats });

// Handle resize event
function onResize() {
  resizeTimer = clearTimer(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = 0;
    cacheLayoutMetrics();
    if (pages[currentPageName] && typeof pages[currentPageName].onResize === "function") {
      pages[currentPageName].onResize();
    }
  }, 80);
}

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let isTouchActive = false;

let mouseStartX = 0;
let mouseStartY = 0;
let mouseStartTime = 0;
let isMouseDown = false;

function onTouchStart(event) {
  if (event.touches.length !== 1) {
    isTouchActive = false;
    return;
  }
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchStartTime = Date.now();
  isTouchActive = true;
  showIndicatorTemporarily();
}

function onTouchMove() {
  showIndicatorTemporarily();
}

function onTouchEnd(event) {
  if (!isTouchActive) return;
  isTouchActive = false;
  const touch = event.changedTouches[0];
  if (!touch) return;

  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;
  const deltaTime = Date.now() - touchStartTime;

  if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && deltaTime < 1000) {
    if (deltaX < 0) {
      if (window.navManager) window.navManager.nextPage();
    } else {
      if (window.navManager) window.navManager.prevPage();
    }
  }
  showIndicatorTemporarily();
}

function onTouchCancel() {
  isTouchActive = false;
}

function onMouseDown(event) {
  if (event.button !== 0) return;
  if (event.target.closest?.(".castboard-context-menu, .page-indicator")) {
    return;
  }
  mouseStartX = event.clientX;
  mouseStartY = event.clientY;
  mouseStartTime = Date.now();
  isMouseDown = true;
  showIndicatorTemporarily();
}

function onMouseMove() {
  showIndicatorTemporarily();
}

function onMouseUp(event) {
  if (!isMouseDown) return;
  isMouseDown = false;

  const deltaX = event.clientX - mouseStartX;
  const deltaY = event.clientY - mouseStartY;
  const deltaTime = Date.now() - mouseStartTime;

  if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && deltaTime < 800) {
    if (deltaX < 0) {
      if (window.navManager) window.navManager.nextPage();
    } else {
      if (window.navManager) window.navManager.prevPage();
    }
  }
  showIndicatorTemporarily();
}

function onPageClick() {
  if (hideContextMenu()) return;
  if (window.currentPageName === "time" && window.navManager) {
    window.navManager.restoreTransient();
    return;
  }
  showIndicatorTemporarily();
}

function preventContextMenu(event) {
  if (!contextMenu) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  contextMenu.hidden = false;
  const inset = 8;
  const maxLeft = Math.max(inset, window.innerWidth - contextMenu.offsetWidth - inset);
  const maxTop = Math.max(inset, window.innerHeight - contextMenu.offsetHeight - inset);
  contextMenu.style.left = `${Math.min(Math.max(inset, event.clientX), maxLeft)}px`;
  contextMenu.style.top = `${Math.min(Math.max(inset, event.clientY), maxTop)}px`;
}

function preventWheelZoom(event) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
}

let timeSchedulerTimerId = 0;
let lastTimeTriggeredMinute = -1;

function startTimeScheduler() {
  timeSchedulerTimerId = window.setInterval(() => {
    if (bootLocked) return;
    const now = new Date();
    const minutes = now.getMinutes();
    if (minutes === 0 || minutes === 30) {
      if (minutes !== lastTimeTriggeredMinute) {
        lastTimeTriggeredMinute = minutes;
        if (window.navManager) {
          window.navManager.showTransient("time", 4000);
        }
      }
    } else {
      lastTimeTriggeredMinute = -1;
    }
  }, 1000);
}

function stopTimeScheduler() {
  if (timeSchedulerTimerId) {
    window.clearInterval(timeSchedulerTimerId);
    timeSchedulerTimerId = 0;
  }
}

function cleanupScheduledWork() {
  resizeTimer = clearTimer(resizeTimer);
  if (pageIndicatorTimer) {
    clearTimeout(pageIndicatorTimer);
    pageIndicatorTimer = 0;
  }
  stopTimeScheduler();
  if (window.navManager) {
    window.navManager.destroy();
  }
  Object.values(pages).forEach(page => {
    if (typeof page.cleanup === "function") {
      page.cleanup();
    }
  });
}

function bindEvents() {
  createContextMenu();
  createPageIndicator();
  window.addEventListener("resize", onResize);
  window.addEventListener("lyrics-track-change", onTrackChange);
  window.addEventListener("lyrics-progress-change", onProgressChange);
  window.addEventListener("lyrics-lines-change", () => {
    if (pages.lyrics && typeof pages.lyrics.layoutLyrics === "function") {
      pages.lyrics.layoutLyrics();
    }
  });
  window.addEventListener("click", onPageClick);
  window.addEventListener("contextmenu", preventContextMenu);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
    if (event.key === "ArrowLeft") {
      if (window.navManager) window.navManager.prevPage();
      showIndicatorTemporarily();
    } else if (event.key === "ArrowRight") {
      if (window.navManager) window.navManager.nextPage();
      showIndicatorTemporarily();
    }
  });
  window.addEventListener("wheel", preventWheelZoom, { passive: false });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchCancel, { passive: true });
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("beforeunload", cleanupScheduledWork);
}

const loadedPages = new Set();
const totalPages = ["lyrics", "detail", "time", "sysinfo"];
let bootCalled = false;

window.onIframeLoad = function(pageName) {
  loadedPages.add(pageName);

  // Sync language to the loaded iframe
  const lang = window.castBoardHost.config.language;
  if (lang) {
    const iframe = document.getElementById(`iframe-${pageName}`);
    if (iframe?.contentDocument?.documentElement) {
      iframe.contentDocument.documentElement.setAttribute('lang', lang);
    }
  }

  if (totalPages.every(p => loadedPages.has(p))) {
    if (!bootCalled) {
      bootCalled = true;
      boot();
    }
  }
};

// ==== Boot Flow ====
function boot() {
  bindEvents();
  cacheLayoutMetrics();
  startTimeScheduler();
  log("app", "page-initialized", {
    resolution: { width: window.innerWidth, height: window.innerHeight },
    language: window.castBoardHost.config.language || document.documentElement.lang,
  });

  window.setTimeout(() => {
    bootLocked = false;
  }, 5000);

  const ready = document.fonts?.ready ?? Promise.resolve();
  ready.then(() => {
    const stored = window.navManager.getStoredPage();
    const initialPage = (stored === "sysinfo" && !window.castBoardHost.featureGates.sysinfoBasic)
      ? "lyrics"
      : stored;
    window.navManager.navigateTo(initialPage);
  });
}
