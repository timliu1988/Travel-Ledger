// Service worker：讓 App 在沒網路時也能打開。
// 自己的檔案「先抓網路、失敗才用快取」，所以更新程式後重新整理就會拿到新版。
const CACHE = 'tl-v5';
const LIB_CACHE = 'tl-lib'; // 外部程式庫另外存，App 更新版本時不用重新下載
const SHELL = [
  './', './index.html', './style.css', './app.js', './store.js', './firebase-config.js',
  './calc.js', './media.js', './ocr.js', './calendar.js', './ai.js',
  './ui.js', './state.js', './forms.js', './views-trip.js', './views-ledger.js', './search.js', './backup.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== LIB_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 自己網站的檔案：網路優先（3 秒逾時），失敗用快取
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([fetch(req), timeout(3000)]);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        return hit || (await cache.match('./index.html')) || Response.error();
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
