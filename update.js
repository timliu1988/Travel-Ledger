// 新版本檢查：App 先用手機裡的版本打開，之後在背景問 GitHub 有沒有新版。
// 有新版就在畫面上方跳出提示，使用者按了才更新（不會記帳記到一半突然重新整理）。
import { $ } from './ui.js';

const CHECK_EVERY = 30 * 60 * 1000; // 回到 App 時，距離上次檢查超過 30 分鐘才再問一次
let reg = null;
let lastCheck = 0;
let reloading = false;
export const appBuild = { value: '' };

function showBanner(worker) {
  if ($('#update-bar')) return;
  const bar = document.createElement('button');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.type = 'button';
  bar.innerHTML = `<span>🎉 有新版本</span><b>點此更新</b>`;
  bar.addEventListener('click', () => {
    bar.innerHTML = `<span>更新中…</span>`;
    worker.postMessage({ type: 'skip-waiting' });
    // 萬一新版遲遲沒有接手，3 秒後直接重新載入
    setTimeout(() => { if (!reloading) { reloading = true; location.reload(); } }, 3000);
  });
  document.body.appendChild(bar);
}

function watch(worker) {
  if (!worker) return;
  const ready = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showBanner(worker); };
  ready();
  worker.addEventListener('statechange', ready);
}

async function check() {
  if (!reg || !navigator.onLine) return;
  lastCheck = Date.now();
  try { await reg.update(); } catch { /* 沒網路或 GitHub 連不上：下次再試 */ }
}

export function initUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  sw.addEventListener('message', (e) => { if (e.data?.type === 'build') { appBuild.value = e.data.build; const el = $('#app-build'); if (el) el.textContent = e.data.build; } });
  // 等畫面先畫好再註冊、再檢查，不佔用啟動時間
  const go = async () => {
    try {
      reg = await sw.register('./sw.js');
    } catch (e) { console.warn('SW', e); return; }
    if (!reg) return;
    if (reg.waiting) watch(reg.waiting);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    sw.controller?.postMessage({ type: 'build' });
    lastCheck = Date.now(); // register 本身就會檢查一次
  };
  if (document.readyState === 'complete') setTimeout(go, 500); else window.addEventListener('load', () => setTimeout(go, 500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > CHECK_EVERY) check();
  });
  window.addEventListener('online', () => { if (Date.now() - lastCheck > CHECK_EVERY) check(); });
}

/** 設定頁的「檢查更新」按鈕 */
export async function checkNow() {
  if (!reg) return 'unsupported';
  if (!navigator.onLine) return 'offline';
  await check();
  if (reg.waiting || reg.installing) return 'found';
  return 'latest';
}
