async function loadTemplate() {
  const response = await fetch(new URL("./template.html", import.meta.url));
  if (!response.ok) throw new Error(`Failed to load template: ${response.status}`);
  return response.text();
}
let updateTimer = null;
let schedulerTimer = null;
let lastTriggeredMinute = -1;
let mountedContainer = null;

        function updateTime(container) {
          const clockEl = container.querySelector("#time-clock-display");
          const dateEl = container.querySelector("#time-date-display");
          if (!clockEl || !dateEl) return;

          const now = new Date();
          const lang = document.documentElement.getAttribute("lang") || "zh-CN";

          // Format clock: HH:MM
          const hours = String(now.getHours()).padStart(2, "0");
          const minutes = String(now.getMinutes()).padStart(2, "0");
          clockEl.textContent = `${hours}:${minutes}`;

          // Format date
          const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
          try {
            dateEl.textContent = now.toLocaleDateString(lang, dateOptions);
          } catch (error) {
            window.castBoardUtils.log("time", "date-localization-failed", {
              language: lang,
              error: String(error),
            });
            dateEl.textContent = now.toLocaleDateString('zh-CN', dateOptions);
          }
        }

        const plugin = {
          async mount(shadowRoot, context) {
            const template = await loadTemplate();
            shadowRoot.innerHTML = template;
            const container = shadowRoot;
            mountedContainer = container;
            updateTime(container);
            schedulerTimer = setInterval(() => {
              const minute = new Date().getMinutes();
              if (minute === 0 || minute === 30) {
                if (minute !== lastTriggeredMinute) {
                  lastTriggeredMinute = minute;
                  context.navigation.showTransient(4000);
                }
              } else {
                lastTriggeredMinute = -1;
              }
            }, 1000);
          },
          activate() {
            updateTime(mountedContainer);
            updateTimer = setInterval(() => updateTime(mountedContainer), 1000);
          },
          deactivate() {
            if (updateTimer) {
              clearInterval(updateTimer);
              updateTimer = null;
            }
          },
          unmount() {
            mountedContainer = null;
            clearInterval(schedulerTimer);
            schedulerTimer = null;
          }
        };
export const manifest = Object.freeze({
  schemaVersion: "1.0.0",
  id: "time",
  name: {
    en: "Time",
    "zh-CN": "时间",
    ja: "時刻",
    ko: "시간",
    "zh-TW": "時間",
    de: "Uhrzeit",
    es: "Hora",
    ru: "Время",
  },
  description: {
    en: "Displays the current time and date every half hour.",
    "zh-CN": "每半小时显示当前时间和日期。",
    ja: "30分ごとに現在の時刻と日付を表示します。",
    ko: "30분마다 현재 시간과 날짜를 표시합니다.",
    "zh-TW": "每半小時顯示目前時間和日期。",
    de: "Zeigt alle 30 Minuten die aktuelle Uhrzeit und das Datum an.",
    es: "Muestra la hora y la fecha actuales cada media hora.",
    ru: "Показывает текущие время и дату каждые полчаса.",
  },
  version: "1.0.0",
  minCastBoardVersion: "1.0.0",
  type: "transient",
  entry: "index.js",
});

export default plugin;
