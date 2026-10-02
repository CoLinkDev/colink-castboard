async function loadTemplate() {
  const response = await fetch(new URL("./template.html", import.meta.url));
  if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
  return response.text();
}
let mountedContainer = null;
let unsubscribeStats = null;
let latestStats = null;
let active = false;

        const currentValues = {
          cpu: null,
          mem: null,
          gpu: null,
          netDown: null,
          netUp: null,
          diskRead: null,
          diskWrite: null,
        };
        const activeAnimations = {};

        function easeOutCubic(t) {
          return 1 - Math.pow(1 - t, 3);
        }

        function cancelAnimation(key) {
          if (activeAnimations[key]) {
            cancelAnimationFrame(activeAnimations[key].rafId);
            delete activeAnimations[key];
          }
        }

        function cancelAllAnimations() {
          for (const key of Object.keys(activeAnimations)) {
            cancelAnimationFrame(activeAnimations[key].rafId);
            delete activeAnimations[key];
          }
        }

        function animateValue(key, targetValue, onUpdate, duration = 350) {
          if (targetValue === null || targetValue === undefined) {
            cancelAnimation(key);
            currentValues[key] = null;
            onUpdate(null);
            return;
          }

          const targetNum = Number(targetValue);
          const startVal = currentValues[key] === null ? targetNum : currentValues[key];

          if (currentValues[key] === null || startVal === targetNum) {
            cancelAnimation(key);
            currentValues[key] = targetNum;
            onUpdate(targetNum);
            return;
          }

          cancelAnimation(key);

          const startTime = performance.now();

          function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const eased = easeOutCubic(progress);
            const current = startVal + (targetNum - startVal) * eased;
            currentValues[key] = current;
            onUpdate(current);

            if (progress < 1) {
              activeAnimations[key] = {
                rafId: requestAnimationFrame(step),
              };
            } else {
              currentValues[key] = targetNum;
              onUpdate(targetNum);
              delete activeAnimations[key];
            }
          }

          activeAnimations[key] = {
            rafId: requestAnimationFrame(step),
          };
        }

        function normalize(value) {
          if (value === null || value === undefined) return null;
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return null;
          return Math.min(100, Math.max(0, parsed));
        }

        function localizeUI(container) {
          const t = window.castBoardI18n.messages("sysinfo");
          if (!t) return;
          const map = {
            cpu: t.cpuDesc,
            mem: t.memDesc,
            gpu: t.gpuDesc,
            netDown: t.netDownDesc,
            netUp: t.netUpDesc,
            diskRead: t.diskReadDesc,
            diskWrite: t.diskWriteDesc,
          };
          for (const [key, desc] of Object.entries(map)) {
            const el = container.querySelector(`[data-key="${key}"]`);
            if (el && desc) {
              el.setAttribute("title", desc);
              el.setAttribute("aria-label", desc);
            }
          }
        }

        // Format speed rate in B/s, KB/s, MB/s, GB/s
        function formatRate(value) {
          if (value === null || value === undefined) return { value: "--", unit: "" };
          const bytes = Math.max(0, Number(value));
          if (!Number.isFinite(bytes)) return { value: "--", unit: "" };
          const units = ["B/s", "KB/s", "MB/s", "GB/s"];
          let scaled = bytes;
          let index = 0;
          while (scaled >= 1024 && index < units.length - 1) {
            scaled /= 1024;
            index += 1;
          }
          const text = scaled >= 100 || index === 0 ? String(Math.round(scaled)) : scaled.toFixed(1);
          return { value: text, unit: units[index] };
        }

        function render(container) {
          if (!container || !latestStats) return;

          for (const key of ["cpu", "mem", "gpu"]) {
            const metric = container.querySelector(`[data-key="${key}"]`);
            const fillEl = metric?.querySelector("[data-fill]");
            if (!metric || !fillEl) continue;

            const value = normalize(latestStats[key]);
            metric.dataset.empty = value == null ? "true" : "false";

            // Circumference of r=50 circle is 2 * PI * 50 = 314.159
            const dashoffset = value == null ? 314.159 : 314.159 * (1 - value / 100);
            fillEl.setAttribute("stroke-dashoffset", String(dashoffset));

            if (value !== null && value > 75) {
              metric.classList.add("high-load");
            } else {
              metric.classList.remove("high-load");
            }

            animateValue(key, value, (current) => {
              if (!mountedContainer) return;
              const curValueEl = metric.querySelector("[data-value]");
              if (curValueEl) {
                curValueEl.textContent = current == null ? "--" : String(Math.round(current));
              }
            });
          }

          for (const key of ["netDown", "netUp", "diskRead", "diskWrite"]) {
            const metric = container.querySelector(`[data-key="${key}"]`);
            if (!metric) continue;

            const raw = latestStats[key];
            const empty = raw == null;
            metric.dataset.empty = empty ? "true" : "false";

            animateValue(key, raw, (current) => {
              if (!mountedContainer) return;
              const curValueEl = metric.querySelector(`[data-value-for="${key}"]`);
              const curUnitEl = metric.querySelector(`[data-unit-for="${key}"]`);
              if (curValueEl && curUnitEl) {
                const formatted = formatRate(current);
                curValueEl.textContent = formatted.value;
                curUnitEl.textContent = formatted.unit;
              }
            });
          }
        }

        const plugin = {
          async mount(shadowRoot, context) {
            const template = await loadTemplate();
            shadowRoot.innerHTML = template;
            const container = shadowRoot;
            mountedContainer = container;
            localizeUI(container);
            unsubscribeStats = context.events.on("sysinfo.stats", (payload) => {
              latestStats = normalizeStats(payload);
              if (active) render(mountedContainer);
            });
            render(container);
          },
          activate() {
            active = true;
            window.castBoardHost.startSysInfoAlive();
            render(mountedContainer);
          },
          deactivate() {
            active = false;
            window.castBoardHost.stopSysInfoAlive();
            cancelAllAnimations();
          },
          unmount() {
            active = false;
            mountedContainer = null;
            window.castBoardHost.stopSysInfoAlive();
            unsubscribeStats?.();
            unsubscribeStats = null;
            cancelAllAnimations();
            for (const key of Object.keys(currentValues)) {
              currentValues[key] = null;
            }
          },
          onResize() {
            render(mountedContainer);
          }
        };

function normalizeStats(payload) {
  const percent = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
  };
  const rate = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : null;
  };
  return {
    cpu: percent(payload?.cpu),
    mem: percent(payload?.mem),
    gpu: percent(payload?.gpu),
    netUp: rate(payload?.net_up ?? payload?.netUp),
    netDown: rate(payload?.net_down ?? payload?.netDown),
    diskRead: rate(payload?.disk_read ?? payload?.diskRead),
    diskWrite: rate(payload?.disk_write ?? payload?.diskWrite),
  };
}
export const manifest = Object.freeze({
  schemaVersion: "1.0.0",
  id: "sysinfo",
  name: {
    en: "System Information",
    "zh-CN": "系统信息",
    ja: "システム情報",
    ko: "시스템 정보",
    "zh-TW": "系統資訊",
    de: "Systeminformationen",
    es: "Información del sistema",
    ru: "Сведения о системе",
  },
  description: {
    en: "Displays live processor, memory, graphics, network, and disk activity.",
    "zh-CN": "实时显示处理器、内存、图形、网络和磁盘活动。",
    ja: "プロセッサ、メモリ、グラフィックス、ネットワーク、ディスクの動作状況をリアルタイムで表示します。",
    ko: "프로세서, 메모리, 그래픽, 네트워크 및 디스크 활동을 실시간으로 표시합니다.",
    "zh-TW": "即時顯示處理器、記憶體、圖形、網路和磁碟活動。",
    de: "Zeigt Prozessor-, Arbeitsspeicher-, Grafik-, Netzwerk- und Datenträgeraktivität in Echtzeit an.",
    es: "Muestra en tiempo real la actividad del procesador, la memoria, los gráficos, la red y el disco.",
    ru: "В реальном времени показывает активность процессора, памяти, графики, сети и дисков.",
  },
  version: "1.0.0",
  minCastBoardVersion: "2.2.0",
  type: "navigable",
  entry: "index.js",
});

export default plugin;
