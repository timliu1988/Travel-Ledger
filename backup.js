// 備份與還原：把整本帳本存成一個檔案（可存到 iCloud 雲碟），需要時再匯入
import { receiptKey } from './store.js';

/**
 * 匯出整本帳本
 * @returns {Promise<Blob>}
 */
export async function exportLedger(store, ld, { withReceipts = false, onProgress } = {}) {
  const trips = [];
  const list = Object.values(ld.trips).filter((t) => !t.trip.deletedAt); // 最近刪除裡的不備份
  let n = 0;
  for (const t of list) {
    const receipts = {};
    if (withReceipts) {
      for (const e of t.expenses) {
        const cnt = e.receiptCount ?? (e.hasReceipt ? 1 : 0);
        for (let i = 0; i < cnt; i++) {
          const key = receiptKey(e.id, i);
          try { const url = await store.getReceipt(t.trip.id, key); if (url) receipts[key] = url; } catch { /* 略過讀不到的 */ }
        }
      }
    }
    trips.push({ trip: t.trip, expenses: t.expenses, exchanges: t.exchanges, receipts });
    onProgress?.(++n, list.length);
  }
  const data = {
    app: 'travel-ledger', version: 4, exportedAt: new Date().toISOString(),
    ledger: ld.ledger, trips,
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/**
 * 從備份檔建立一本「新的」帳本（不會覆蓋現有資料）
 * @returns {Promise<{lid: string, oldId: string}>} 新帳本 id、備份裡原本的帳本 id
 */
export async function importLedger(store, file, { onProgress } = {}) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'travel-ledger' || !data.ledger || !Array.isArray(data.trips)) throw new Error('這不是旅伴記帳的備份檔');
  const { id: _old, tripIds: _t, ...ledgerFields } = data.ledger; // eslint-disable-line no-unused-vars
  const lid = store.createLedger({ ...ledgerFields, name: `${data.ledger.name || '帳本'}（還原）`, tripIds: [], restoredAt: Date.now() });
  let n = 0;
  for (const t of data.trips) {
    const { id: _tid, ledgerId: _l, ...tripFields } = t.trip;
    const tid = store.createTrip(lid, tripFields);
    const idMap = {};
    for (const e of t.expenses || []) {
      const { id, ...rest } = e;
      const newId = store.newId();
      idMap[id] = newId;
      store.addItem(tid, 'expenses', rest, newId);
    }
    for (const x of t.exchanges || []) {
      const { id: _x, ...rest } = x;
      store.addItem(tid, 'exchanges', rest);
    }
    for (const [key, url] of Object.entries(t.receipts || {})) {
      const m = key.match(/^(.+?)(_\d+)?$/);
      const newKey = (idMap[m[1]] || m[1]) + (m[2] || '');
      await store.saveReceipt(tid, newKey, url);
    }
    onProgress?.(++n, data.trips.length);
  }
  return { lid, oldId: data.ledger.id };
}

/** 匯出 CSV（Excel 可直接開，含中文） */
export function exportCsv(tripsData, memberName) {
  const head = ['旅程', '日期', '項目', '分類', '幣別', '金額', '付款方式', '台幣出帳金額', '約合台幣', '付款人', '分攤方式', '分攤對象', '品項原文', '品項中文', '品項金額', '品項歸屬', '備註'];
  const rows = [head];
  const cats = { food: '餐飲', transport: '交通', stay: '住宿', shopping: '購物', fun: '門票娛樂', other: '其他' };
  for (const d of tripsData) {
    for (const r of d.rows) {
      const base = [
        d.trip.name, r.date || '', r.title, cats[r.category] || '', r.currency, r.amountPending ? '金額待補' : r.amount,
        r.method === 'card' ? '刷卡' : '現金', r.billedTwd ?? '', r.val.twd != null ? Math.round(r.val.twd) : '',
        memberName(r.paidBy), r.splitMode === 'items' ? '逐項' : r.splitMode === 'self' ? '個人' : '平分',
        Object.keys(r.fractions).map(memberName).join('、'),
      ];
      if (r.items?.length) {
        for (const it of r.items) {
          rows.push([...base, it.name, it.nameZh || '', it.amount, (it.owners || []).map(memberName).join('、') || '大家', r.note || '']);
        }
      } else {
        rows.push([...base, '', '', '', '', r.note || '']);
      }
    }
  }
  const csv = rows.map((row) => row.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
}
