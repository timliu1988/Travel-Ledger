// Service worker：讓 App 打開時不用等網路，沒網路也能用。
//
// 運作方式
//   1. App 的檔案整包存在手機裡（快取），打開時直接用，瞬間開好。
//   2. App 開好後在背景問 GitHub「這個檔案有沒有變」：只要 BUILD 不一樣，就在背景把新版整包下載好，
//      App 畫面上方會出現「有新版本」，按了才換成新版（不會用到一半突然換掉）。
//   3. 沒網路就跳過檢查，下次打開再問。
//
// ⚠️ 檔名不要用底線「_」開頭：GitHub Pages 會把這種檔案藏起來，手機就下載不到。
// ⚠️ 之後改了任何檔案再上傳 GitHub 時，記得把下面的 BUILD 改成新的（例如改日期），手機才會發現有新版。
const BUILD = 'v5.4-2026.10.25';
const CACHE = 'tl-' + BUILD;
const LIB_CACHE = 'tl-lib'; // 外部程式庫另外存，App 更新版本時不用重新下載
const SHELL = [
  './', './index.html', './style.css', './app.js', './store.js', './firebase-config.js',
  './calc.js', './media.js', './ocr.js', './calendar.js', './ai.js', './update.js', './move.js', './whatsnew.js', './theme.js', './icons.js',
  './ui.js', './state.js', './forms.js', './views-trip.js', './views-ledger.js', './search.js', './backup.js',
  ...['common', 'journal-dark', 'journal', 'midnight-light', 'midnight', 'mist-dark', 'mist', 'outline-dark', 'outline', 'pop-dark-navy', 'pop-dark', 'pop'].map((n) => `./themes/${n}.css`),
  './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = 跳過瀏覽器自己的暫存，確保下載到的是 GitHub 上最新的檔案
  // 主程式檔案一定要全部下載成功才算安裝好；外觀主題的樣式檔少了也沒關係（用到時再上網抓）
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    const get = (u) => c.add(new Request(u, { cache: 'reload' }));
    await Promise.all(SHELL.filter((u) => !u.includes('/themes/')).map(get));
    await Promise.allSettled(SHELL.filter((u) => u.includes('/themes/')).map(get));
  }));
  // 第一次安裝（手機上還沒有舊版）直接啟用；更新時則等使用者按「更新」
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'skip-waiting') self.skipWaiting();
  if (e.data?.type === 'build') e.source?.postMessage({ type: 'build', build: BUILD });
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== LIB_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 自己網站的檔案：直接用手機裡存的（快），沒存到的才上網抓
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const isPage = req.mode === 'navigate';
      const hit = await cache.match(isPage ? './index.html' : req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok && !isPage) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Firebase 程式庫、收據辨識程式（網址含版本號、不會變）：快取優先，離線也能用
  if ((url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
    || (url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(tesseract\.js|tesseract\.js-core|@tesseract\.js-data)[@/]/.test(url.pathname))) {
    e.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
  // 其他（例如 Firestore 連線）不攔截
});
