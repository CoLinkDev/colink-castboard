(() => {
  const translations = Object.freeze({
    en: {
      contextMenu: { close: "Close", openDevTools: "Open DevTools" },
      lyrics: { noLyrics: "No lyrics available" },
      track: { unknownTitle: "Unknown Song", unknownAuthor: "Unknown Artist" },
      sysinfo: {
        cpuDesc: "Processor", memDesc: "Memory", gpuDesc: "Graphics", netDownDesc: "Download",
        netUpDesc: "Upload", diskReadDesc: "Read", diskWriteDesc: "Write",
      },
    },
    zh_CN: {
      contextMenu: { close: "关闭", openDevTools: "打开 DevTools" },
      lyrics: { noLyrics: "暂无歌词" },
      track: { unknownTitle: "未知歌曲", unknownAuthor: "未知艺术家" },
      sysinfo: {
        cpuDesc: "处理器", memDesc: "内存", gpuDesc: "图形", netDownDesc: "下载",
        netUpDesc: "上传", diskReadDesc: "读取", diskWriteDesc: "写入",
      },
    },
    zh_TW: {
      contextMenu: { close: "關閉", openDevTools: "開啟 DevTools" },
      lyrics: { noLyrics: "暫無歌詞" },
      track: { unknownTitle: "未知歌曲", unknownAuthor: "未知藝術家" },
      sysinfo: {
        cpuDesc: "處理器", memDesc: "記憶體", gpuDesc: "圖形", netDownDesc: "下載",
        netUpDesc: "上傳", diskReadDesc: "讀取", diskWriteDesc: "寫入",
      },
    },
    de: {
      contextMenu: { close: "Schließen", openDevTools: "DevTools öffnen" },
      lyrics: { noLyrics: "Keine Liedtexte verfügbar" },
      track: { unknownTitle: "Unbekannter Titel", unknownAuthor: "Unbekannter Künstler" },
      sysinfo: {
        cpuDesc: "Prozessor", memDesc: "Speicher", gpuDesc: "Grafik", netDownDesc: "Download",
        netUpDesc: "Upload", diskReadDesc: "Lesen", diskWriteDesc: "Schreiben",
      },
    },
    es: {
      contextMenu: { close: "Cerrar", openDevTools: "Abrir DevTools" },
      lyrics: { noLyrics: "No hay letras disponibles" },
      track: { unknownTitle: "Canción desconocida", unknownAuthor: "Artista desconocido" },
      sysinfo: {
        cpuDesc: "Procesador", memDesc: "Memoria", gpuDesc: "Gráficos", netDownDesc: "Descarga",
        netUpDesc: "Subida", diskReadDesc: "Lectura", diskWriteDesc: "Escritura",
      },
    },
    ja: {
      contextMenu: { close: "閉じる", openDevTools: "DevTools を開く" },
      lyrics: { noLyrics: "歌詞はありません" },
      track: { unknownTitle: "不明な曲", unknownAuthor: "不明なアーティスト" },
      sysinfo: {
        cpuDesc: "プロセッサ", memDesc: "メモリ", gpuDesc: "グラフィックス", netDownDesc: "ダウンロード",
        netUpDesc: "アップロード", diskReadDesc: "読み取り", diskWriteDesc: "書き込み",
      },
    },
    ko: {
      contextMenu: { close: "닫기", openDevTools: "DevTools 열기" },
      lyrics: { noLyrics: "가사가 없습니다" },
      track: { unknownTitle: "알 수 없는 노래", unknownAuthor: "알 수 없는 아티스트" },
      sysinfo: {
        cpuDesc: "프로세서", memDesc: "메모리", gpuDesc: "그래픽", netDownDesc: "다운로드",
        netUpDesc: "업로드", diskReadDesc: "읽기", diskWriteDesc: "쓰기",
      },
    },
    ru: {
      contextMenu: { close: "Закрыть", openDevTools: "Открыть DevTools" },
      lyrics: { noLyrics: "Нет текста песни" },
      track: { unknownTitle: "Неизвестная композиция", unknownAuthor: "Неизвестный исполнитель" },
      sysinfo: {
        cpuDesc: "Процессор", memDesc: "Память", gpuDesc: "Графика", netDownDesc: "Загрузка",
        netUpDesc: "Отдача", diskReadDesc: "Чтение", diskWriteDesc: "Запись",
      },
    },
  });

  function resolveLocale(language = document.documentElement.getAttribute("lang")) {
    const normalized = String(language || "").toLowerCase();
    if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-hant")) return "zh_TW";
    if (normalized.startsWith("zh")) return "zh_CN";
    if (normalized.startsWith("de")) return "de";
    if (normalized.startsWith("es")) return "es";
    if (normalized.startsWith("ja")) return "ja";
    if (normalized.startsWith("ko")) return "ko";
    if (normalized.startsWith("ru")) return "ru";
    return "en";
  }

  function messages(scope, language) {
    return translations[resolveLocale(language)][scope];
  }

  function t(key, language) {
    const value = key.split(".").reduce((current, segment) => current?.[segment], translations[resolveLocale(language)]);
    return typeof value === "string" ? value : translations.en[key.split(".").reduce((current, segment) => current?.[segment], translations.en)];
  }

  window.castBoardI18n = Object.freeze({ messages, resolveLocale, t });
})();
