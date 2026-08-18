/*
 * Service Worker —— 刻意保守的「網路優先」（network-first）策略。
 *
 * 存在理由有兩個，次序有意義：
 *   1. Chromium 要有已註冊嘅 SW（加 manifest）先會發出
 *      `beforeinstallprompt`，冇 SW 就冇「一撳安裝」掣（見
 *      js/lib/install.js 頭註）。
 *   2. 離線時 app 開得到（fallback）。
 *
 * **快取係離線後備，唔係加速手段。** 呢個 app 仲喺開發中，SIR 會頻密重新
 * 部署；cache-first 會餵返舊畫面畀佢，睇落同「壞咗」一模一樣，而且極難
 * 診斷。所以每一個請求都一定先行網路，網路真係失敗（離線／逾時錯誤）先
 * 至攞快取。代價係離線時第一次請求要等網路 timeout——換返嚟嘅係「部署完
 * 重新整理一定見到新版」，呢個 trade-off 係刻意揀嘅。
 *
 * 版本規則：**改咗 SHELL 內任何檔案，就要把 VERSION 加一。** 網路優先其
 * 實已經令舊 shell 唔會被送到使用者手上，但舊版快取留住會白佔空間，而且
 * 離線 fallback 應該係最後一次成功載入嘅版本。activate 時會刪走所有唔係
 * 當前 CACHE 名嘅快取。
 */

const VERSION = 'v1';
const CACHE = `dse-study-log-${VERSION}`;

// 離線後備要有嘅檔案。全部相對路徑：SW 的相對 URL 以 SW 檔案本身（app
// 根目錄）為 base，所以 localhost:8005/ 同 GitHub Pages 的
// /dse-study-log/ 子路徑兩邊都解析正確，唔使寫死。
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './js/main.js',
  './js/api.js',
  './js/state.js',
  './js/i18n.js',
  './js/lib/dates.js',
  './js/lib/format.js',
  './js/lib/stats.js',
  './js/lib/queue.js',
  './js/lib/share.js',
  './js/lib/install.js',
  './js/store.js',
  './js/views/login.js',
  './js/views/calendar.js',
  './js/views/dayEditor.js',
  './i18n/zh.json',
  './i18n/en.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐個 add 而唔用 addAll：addAll 係全有或全冇，任何一個 404（例如將
    // 來搬走咗某個 view）都會令整個 SW 裝唔到，連帶失去安裝掣同離線能力。
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('dse-study-log-') && k !== CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;              // 寫入類請求一律直通

  let url;
  try { url = new URL(request.url); } catch { return; }

  // 後端（Google Apps Script）**絕對唔可以快取**：登入 token、學生記錄、
  // 全班總覽全部經呢度走，餵舊資料等同資料錯亂。同源以外亦一律唔理。
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

/**
 * 先網路，失敗先至快取。成功嘅回應順手更新快取（下次離線用得著）。
 * 導覽（navigate）請求連快取都冇時，回退到 './index.html'——呢個 app 係
 * 單頁式，任何路徑都由同一份 index.html 開機。
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
