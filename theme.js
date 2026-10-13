// 外觀主題：每支手機各自記住選了哪個主題、要淺色／深色／跟隨系統。
// 開 App 時 index.html 裡的小程式會先套用（避免畫面先閃一下預設樣式），之後的切換由這裡處理。
import { ls } from './ui.js';
import { startIcons, stopIcons } from './icons.js';

// files：[淺色檔, 深色檔]（themes/ 資料夾裡）；sw：設定頁色票 [淺色底, 重點色, 深色底]
// ⚠️ index.html 開頭也有一份同樣的對照表，新增主題時兩邊都要改
export const THEMES = [
  { id: 'default', name: '預設', desc: '原本的樣式', files: null, sw: ['#f3f5f4', '#0f766e', '#0f1514'] },
  { id: 'mist', name: 'A 清透', desc: '清爽、接近 iPhone 原生', files: ['mist', 'mist-dark'], sw: ['#f2f3f7', '#2f6bff', '#000000'] },
  { id: 'journal', name: 'B 旅行手帳', desc: '紙張、票根、明體字', files: ['journal', 'journal-dark'], sw: ['#f3ece0', '#c4552d', '#1b1611'] },
  { id: 'midnight', name: 'C 夜旅', desc: '漸層光暈、毛玻璃', files: ['midnight-light', 'midnight'], sw: ['#eef0fb', '#818cf8', '#070b18'] },
  { id: 'pop', name: 'D 活潑撞色', desc: '彩色色塊、粗黑框', files: ['pop', 'pop-dark-navy'], sw: ['#fff4e0', '#ff7aa2', '#0f1724'] },
  { id: 'outline', name: 'E 霓虹框', desc: '彩色框線、實心陰影', files: ['outline', 'outline-dark'], sw: ['#fffaf1', '#ff4f86', '#111111'] },
];
export const MODES = [['light', '☀️ 淺色'], ['dark', '🌙 深色'], ['auto', '跟隨系統']];

export const getTheme = () => (THEMES.some((t) => t.id === ls.get('tl_theme')) ? ls.get('tl_theme') : 'default');
export const getMode = () => (['light', 'dark', 'auto'].includes(ls.get('tl_mode')) ? ls.get('tl_mode') : 'auto');

const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
export const isDark = () => getMode() === 'dark' || (getMode() === 'auto' && !!mq?.matches);

function setMetaColor() {
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor || meta.content;
}

/** 套用目前的設定；換主題時等新的樣式檔載入完才拿掉舊的，畫面不會閃 */
export function applyTheme() {
  const th = THEMES.find((t) => t.id === getTheme()) || THEMES[0];
  const mode = getMode();
  const dark = isDark();
  const root = document.documentElement;
  if (mode === 'auto') delete root.dataset.mode; else root.dataset.mode = mode;
  root.style.colorScheme = dark ? 'dark' : 'light';
  const links = [...document.querySelectorAll('link.theme-css')];
  if (!th.files) {
    delete root.dataset.theme;
    links.forEach((l) => l.remove());
    stopIcons();
    setMetaColor();
    return;
  }
  root.dataset.theme = th.id;
  const href = `themes/${th.files[dark ? 1 : 0]}.css`;
  const cur = links.at(-1);
  if (cur && cur.getAttribute('href') === href) { startIcons(); setMetaColor(); return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.className = 'theme-css';
  link.href = href;
  link.onload = () => { document.querySelectorAll('link.theme-css').forEach((l) => { if (l !== link) l.remove(); }); setMetaColor(); };
  link.onerror = () => { link.remove(); };
  document.head.appendChild(link);
  startIcons();
}

export function setTheme(id) { ls.set('tl_theme', id); applyTheme(); }
export function setMode(m) { ls.set('tl_mode', m); applyTheme(); }

// iPhone 在白天／晚上自動切換深淺色時，跟著換
mq?.addEventListener?.('change', () => { if (getMode() === 'auto') applyTheme(); });
