// 共用的小工具：格式化、頭像、彈出視窗、提示訊息
import { decimals } from './calc.js';
import { ymd } from './calendar.js';

export const CATS = [
  { id: 'food', name: '餐飲', icon: '🍜' },
  { id: 'transport', name: '交通', icon: '🚃' },
  { id: 'stay', name: '住宿', icon: '🏨' },
  { id: 'shopping', name: '購物', icon: '🛍️' },
  { id: 'fun', name: '門票娛樂', icon: '🎡' },
  { id: 'other', name: '其他', icon: '📦' },
];
export const NO_CAT = { id: 'none', name: '未分類', icon: '📝' };
export const catOf = (id) => CATS.find((c) => c.id === id) || NO_CAT;

export const CURRENCIES = [
  ['JPY', '日圓', '🇯🇵', '日本'], ['KRW', '韓元', '🇰🇷', '韓國'], ['THB', '泰銖', '🇹🇭', '泰國'], ['HKD', '港幣', '🇭🇰', '香港'],
  ['USD', '美元', '🇺🇸', '美國'], ['EUR', '歐元', '🇪🇺', '歐洲'], ['SGD', '新加坡幣', '🇸🇬', '新加坡'], ['VND', '越南盾', '🇻🇳', '越南'],
  ['CNY', '人民幣', '🇨🇳', '中國'], ['MYR', '令吉', '🇲🇾', '馬來西亞'], ['GBP', '英鎊', '🇬🇧', '英國'], ['AUD', '澳幣', '🇦🇺', '澳洲'],
  ['CAD', '加幣', '🇨🇦', '加拿大'], ['CHF', '瑞士法郎', '🇨🇭', '瑞士'], ['PHP', '菲律賓披索', '🇵🇭', '菲律賓'], ['IDR', '印尼盾', '🇮🇩', '印尼'],
  ['NZD', '紐西蘭幣', '🇳🇿', '紐西蘭'], ['MOP', '澳門幣', '🇲🇴', '澳門'], ['TWD', '新台幣', '🇹🇼', '台灣'],
];
export const flag = (code) => CURRENCIES.find((c) => c[0] === code)?.[2] || '💱';
export const curName = (code) => CURRENCIES.find((c) => c[0] === code)?.[1] || code;
export const countryName = (code) => CURRENCIES.find((c) => c[0] === code)?.[3] || code;

export const AVATAR_EMOJIS = [
  '😀', '😎', '🥰', '🤓', '😴', '🤠', '🥳', '😺', '🐶', '🐱', '🐰', '🐻', '🐼', '🐨', '🐯', '🦊',
  '🐷', '🐸', '🐵', '🐧', '🐥', '🦄', '🐳', '🐙', '🌸', '🌻', '🍀', '⭐', '🌈', '🔥', '🍣', '🍜',
  '🍰', '☕', '🍺', '⚽', '🎸', '📷', '✈️', '🧳',
];
const AV_COLORS = ['#0f766e', '#c2410c', '#7c3aed', '#be185d', '#2563eb', '#15803d', '#a16207', '#0e7490'];

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : new Intl.NumberFormat('zh-TW', { maximumFractionDigits: d }).format(n));
export const twd = (n) => (n == null || isNaN(n) ? '—' : 'NT$ ' + fmt(Math.round(n), 0));
export const fx = (n, cur) => (n == null || isNaN(n) ? '—' : fmt(n, decimals(cur)) + ' ' + cur);
export const money = (n, cur) => (cur === 'TWD' ? twd(n) : fx(n, cur));
/** 多幣別金額：{JPY: 1200, TWD: 300} → 「¥… + NT$…」 */
export const moneyMulti = (obj, withFlag = true) => {
  const e = Object.entries(obj || {}).filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => (a[0] === 'TWD') - (b[0] === 'TWD'));
  if (!e.length) return money(0, 'TWD');
  return e.map(([c, v]) => `${withFlag ? flag(c) + ' ' : ''}${money(v, c)}`).join(' ＋ ');
};
/** 多幣別金額，每個幣別一行 */
export const moneyLines = (obj) => {
  const e = Object.entries(obj || {}).filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => (a[0] === 'TWD') - (b[0] === 'TWD'));
  if (!e.length) return `<div>${money(0, 'TWD')}</div>`;
  return e.map(([c, v]) => `<div>${money(v, c)}</div>`).join('');
};
export const rateStr = (r) => (r ? Number(r.toPrecision(4)).toString() : '—');
export const num = (v) => { const x = parseFloat(String(v ?? '').replace(/[,，\s]/g, '')); return isFinite(x) ? x : null; };
export const today = () => ymd(new Date());
export const dayLabel = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
};
export const ls = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 空間不足時略過 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/** 頭像：照片 / emoji / 名字第一個字 */
export function avatar(m, size = 32) {
  if (!m) return '';
  const a = m.avatar;
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * (a?.type === 'emoji' ? 0.6 : 0.45))}px`;
  if (a?.type === 'photo') return `<span class="av" style="${st}"><img src="${esc(a.value)}" alt=""></span>`;
  if (a?.type === 'emoji') return `<span class="av emoji" style="${st}">${esc(a.value)}</span>`;
  const name = m.name || '?';
  const color = AV_COLORS[[...name].reduce((h, c) => h + c.codePointAt(0), 0) % AV_COLORS.length];
  return `<span class="av letter" style="${st};background:${color}">${esc([...name][0])}</span>`;
}

/* ---------------- 彈出視窗（可疊好幾層） ---------------- */
const sheetStack = [];
export function openSheet(title, bodyHTML, onMount, opts = {}) {
  const root = $('#sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div>
    <div class="sheet ${opts.tall ? 'tall' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close-sheet" aria-label="關閉">✕</button></div>
      <div class="sheet-body">${bodyHTML}</div></div>`;
  root.appendChild(wrap);
  sheetStack.push(wrap);
  document.body.style.overflow = 'hidden';
  onMount?.(wrap);
  return wrap;
}
export function closeSheet() {
  const w = sheetStack.pop();
  w?.remove();
  if (!sheetStack.length) document.body.style.overflow = '';
}
export function closeAllSheets() { while (sheetStack.length) closeSheet(); }

export const radio = (name, value, label, checked) =>
  `<label class="opt"><input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
export const check = (name, value, label, checked) =>
  `<label class="opt"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
export const avLabel = (m) => `${avatar(m, 22)}<span class="opt-name">${esc(m.name)}</span>`;

/** 看大圖（可以用兩指放大） */
export function openViewer(src) {
  if (!src) return;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<button class="viewer-close" aria-label="關閉">✕</button><div class="viewer-scroll"><img src="${esc(src)}" alt="收據"></div>`;
  v.addEventListener('click', (e) => { if (e.target.closest('.viewer-close') || e.target === v) v.remove(); });
  document.body.appendChild(v);
}

/** 讓使用者存檔：iPhone 會跳出分享選單，可以選「儲存到檔案」（iCloud 雲碟） */
export async function saveFile(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
