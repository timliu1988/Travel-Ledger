// 更新說明：更新到新版本後第一次打開 App 時顯示一次（每支手機各自記住看過了沒）
import { ls, openSheet, closeSheet, esc } from './ui.js';

export const APP_VERSION = 'v5.4';
// 新版本時在最前面加一筆；只會顯示目前版本的那一筆
const NOTES = {
  'v5.4': [
    ['⇅', '每天可以調整順序', '帳目頁每天標題右邊的「⇅ 排序」，按住 ☰ 上下拖曳，按「完成」儲存。'],
    ['👤', '點旅伴卡片看他的花費', '點上方的旅伴卡片，只顯示跟他有關的帳，並標出他那一份；可以和「待補出帳」一起篩選。'],
    ['🧮', '日本外稅收據自動換算含稅價', '7-11 這類稅另外列的收據，Gemini 會依 8%／10% 把品項換成含稅價，品項下方小字是稅抜價和稅率（點一下可以修改）。'],
    ['💱', '金額下方直接顯示台幣', '例如「＝ NT$ 1,254 已出帳 · 匯率 31.63」。'],
    ['🔄', '可以選 Gemini 模型、換模型重新辨識', '「帳本 → 收據辨識」可以指定模型；辨識結果下方的「換模型辨識」可以用同一組照片換模型重跑。也更新成 Google 最新的免費模型。'],
    ['🧾', '美國小費不攤稅', '逐項分時，稅金只攤到餐點等品項，小費照收據金額算。'],
  ],
};

export function showWhatsNew(force = false) {
  const seen = ls.get('tl_seenVersion');
  const used = (ls.get('tl_ledgers', []) || []).length > 0; // 第一次安裝的人不用看
  if (!force && (seen === APP_VERSION || !used)) { if (!seen || seen !== APP_VERSION) ls.set('tl_seenVersion', APP_VERSION); return; }
  ls.set('tl_seenVersion', APP_VERSION);
  const list = NOTES[APP_VERSION] || [];
  if (!list.length) return;
  openSheet(`🎉 ${APP_VERSION} 更新內容`, `
    <div class="wn-list">${list.map(([ic, t, d]) => `<div class="wn-row"><span class="wn-ic">${ic}</span><div><b>${esc(t)}</b><p class="small muted">${esc(d)}</p></div></div>`).join('')}</div>
    <button class="btn" type="button" data-wn-ok>知道了</button>`, (root) => {
    root.querySelector('[data-wn-ok]').onclick = () => closeSheet();
  });
}
