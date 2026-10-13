// 跨旅程搜尋：品項（原文、中文）、店家/項目名稱、備註、旅程名稱
import { calc } from './calc.js';

/** 正規化：全半形統一、大小寫、平假名轉片假名、去掉空白與符號，讓「ｷｬﾍﾞｼﾞﾝ」也找得到「キャベジン」 */
export function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･\-ー_.,，、()（）[\]「」'"]/g, '');
}

/**
 * @param {Array} tripsData  [{trip, expenses, exchanges}]
 * @param {string} q         搜尋字串，可用空白分開多個關鍵字（全部都要符合）
 * @returns {{results: Array, summary: Object|null}}
 */
export function searchAll(tripsData, q) {
  const words = String(q || '').trim().split(/\s+/).map(norm).filter(Boolean);
  if (!words.length) return { results: [], summary: null };
  const match = (...texts) => {
    const hay = texts.map(norm).join('|');
    return words.every((w) => hay.includes(w));
  };
  const results = [];
  for (const d of tripsData) {
    const c = calc(d, 'split');
    for (const r of c.rows) {
      const ctx = [r.title, r.note, d.trip.name];
      let itemHit = false;
      for (const it of r.items || []) {
        if (match(it.name, it.nameZh, ...ctx) && (match(it.name, it.nameZh) || !match(...ctx))) {
          // 品項金額換算台幣：照這筆支出的換算比例
          const ratio = r.val.twd != null && r.amount ? r.val.twd / r.amount : null;
          // 比價用單價：買 2 個不會被當成比較貴
          const qty = it.qty > 0 ? it.qty : 1;
          const unit = it.price != null ? it.price : it.amount / qty;
          results.push({
            type: 'item', trip: d.trip, expense: r, item: it, qty,
            amount: unit, cur: r.currency, twd: ratio != null ? unit * ratio : null,
          });
          itemHit = true;
        }
      }
      if (!itemHit && match(...ctx)) {
        results.push({ type: 'expense', trip: d.trip, expense: r, amount: r.amount, cur: r.currency, twd: r.val.twd });
      }
    }
  }
  results.sort((a, b) => (b.expense.date || '').localeCompare(a.expense.date || ''));

  // 同一種貨幣的品項價格比較（最低、最高）
  let summary = null;
  const items = results.filter((x) => x.type === 'item' && x.amount > 0);
  if (items.length >= 2) {
    const byCur = {};
    for (const x of items) (byCur[x.cur] ||= []).push(x);
    const [cur, list] = Object.entries(byCur).sort((a, b) => b[1].length - a[1].length)[0];
    if (list.length >= 2) {
      const sorted = [...list].sort((a, b) => a.amount - b.amount);
      summary = { cur, count: list.length, min: sorted[0], max: sorted.at(-1) };
    }
  }
  return { results: results.slice(0, 200), summary, total: results.length };
}
