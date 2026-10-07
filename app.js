// 旅伴記帳 v4 — 主程式：畫面切換、按鈕事件、啟動
import { createStore, uid, receiptKey } from './store.js';
import { calc } from './calc.js';
import { aiReady, aiTranslateNames } from './ai.js';
import { fmtRange } from './calendar.js';
import {
  S, hooks, render, myLedgers, rememberLedger, forgetLedger, getMe, setMe, member, memberName, ledgerMembers, tripData, allTrips,
} from './state.js';
import { $, $$, esc, flag, num, ls, toast, avatar, closeSheet, closeAllSheets, saveFile, openSheet } from './ui.js';
import { welcomeHTML, tripsTab, searchTab, searchResultsHTML, statsTab, ledgerSettingsTab } from './views-ledger.js';
import { listTab, settleTab, exchangeTab, tripSettingsTab } from './views-trip.js';
import {
  nav, needsTranslate, memberUsedInTrip, openTripForm, openMemberForm, openExpenseForm, openExchangeForm,
  openLedgerForm, openJoin, openWhoAmI,
} from './forms.js';
import { exportLedger, importLedger, exportCsv } from './backup.js';

/* ================= 畫面 ================= */
function draw() {
  const app = $('#app');
  const y = window.scrollY;
  if (S.fatal) {
    app.innerHTML = `<main><div class="card"><h3>無法啟動</h3><p class="small">${esc(S.fatal)}</p>
      <button class="btn" onclick="location.reload()">重新載入</button></div></main>`;
    return;
  }
  if (!S.ledgerId) { app.innerHTML = welcomeHTML(); return; }
  if (!S.ld) {
    app.innerHTML = `<header class="top"><div class="titles"><h1>載入中…</h1></div></header>
      <main><p class="muted center">讀取帳本中${S.store.mode === 'firebase' ? '（第一次開啟需要網路）' : ''}</p></main>`;
    return;
  }
  const me = member(getMe());

  if (S.view === 'trip') {
    const d = tripData();
    if (!d) { S.view = 'ledger'; return draw(); }
    const { trip } = d;
    const body = { list: listTab, settle: settleTab, exchange: exchangeTab, settings: tripSettingsTab }[S.tab](d);
    const tabs = [['list', '📒', '帳目'], ['settle', '🤝', '結算'], ['exchange', '💱', '換匯'], ['settings', '⚙️', '設定']];
    app.innerHTML = `
      <header class="top">
        <button class="icon-btn" data-act="back" aria-label="回到帳本">‹</button>
        <div class="titles"><h1>${flag(trip.currency)} ${esc(trip.name)}</h1>
          <div class="sub">${trip.startDate ? esc(fmtRange(trip.startDate, trip.endDate)) + ' · ' : ''}${trip.members.length} 人 · ${esc(trip.currency)}</div></div>
        <span class="me-btn">${avatar(me, 34)}</span>
      </header>
      <main>${body}</main>
      ${S.tab === 'list' ? '<button class="fab" data-act="add-expense" aria-label="新增支出">＋</button>' : ''}
      <nav class="tabs">${tabs.map(([k, i, n]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><span class="i">${i}</span>${n}</button>`).join('')}</nav>`;
  } else {
    const body = { trips: tripsTab, search: searchTab, stats: statsTab, settings: ledgerSettingsTab }[S.ltab]();
    const tabs = [['trips', '🧳', '旅程'], ['search', '🔍', '搜尋'], ['stats', '📊', '統計'], ['settings', '📒', '帳本']];
    app.innerHTML = `
      <header class="top">
        <button class="titles ledger-switch" data-act="ledger-menu"><h1>${esc(S.ld.ledger.name)} <span class="caret">▾</span></h1>
          <div class="sub">${ledgerMembers().length} 位成員 · ${Object.keys(S.ld.trips).length} 趟旅程</div></button>
        <button class="me-btn" data-act="ltab" data-tab="settings" aria-label="我是 ${esc(me?.name || '')}">${avatar(me, 34)}</button>
      </header>
      <main>${body}</main>
      <nav class="tabs">${tabs.map(([k, i, n]) => `<button data-act="ltab" data-tab="${k}" class="${S.ltab === k ? 'on' : ''}"><span class="i">${i}</span>${n}</button>`).join('')}</nav>`;
  }
  window.scrollTo(0, y);
}
hooks.render = draw;

/* ================= 帳本 / 旅程切換 ================= */
function openLedger(id, name) {
  S.unsub?.();
  S.ledgerId = id;
  S.ld = null;
  S.view = 'ledger';
  S.ltab = 'trips';
  S.tripId = null;
  S.askedMe = false;
  S.searchQ = '';
  S.statsYear = 'all';
  S.statsMember = 'all';
  rememberLedger(id, name);
  ls.set('tl_last', id);
  closeAllSheets();
  render();
  window.scrollTo(0, 0);
  S.unsub = S.store.subscribeLedger(id, (ld) => {
    if (S.ledgerId !== id) return;
    if (!ld) {
      toast('這本帳本已不存在（可能被刪除了）');
      forgetLedger(id);
      S.ledgerId = null; S.ld = null;
      const next = myLedgers()[0];
      if (next) openLedger(next.id); else render();
      return;
    }
    // 正在輸入搜尋字時，不要重畫整個畫面（避免鍵盤收起來）
    const typing = document.activeElement?.id === 'q';
    S.ld = ld;
    rememberLedger(id, ld.ledger.name);
    if (S.view === 'trip' && !ld.trips[S.tripId] && !ld.pending) { S.view = 'ledger'; toast('這趟旅程已被刪除'); }
    if (typing) { const box = $('#search-results'); if (box) box.innerHTML = searchResultsHTML(); } else render();
    if (!S.askedMe && !ledgerMembers().some((m) => m.id === getMe())) { S.askedMe = true; openWhoAmI(); }
    if (Object.values(ld.trips).some((t) => t.expenses.some((x) => x.translatePending))) scheduleTranslate();
  });
}
function openTrip(tid, then) {
  S.tripId = tid;
  S.view = 'trip';
  S.tab = 'list';
  S.filter = 'all';
  closeAllSheets();
  render();
  window.scrollTo(0, 0);
  then?.();
}
nav.openTrip = openTrip;
nav.openLedger = openLedger;

/* ================= 待翻譯佇列：離線辨識的品名，連上網路後用 Gemini 補翻譯 ================= */
const translating = new Set();
let translateTimer = 0;
function scheduleTranslate() {
  clearTimeout(translateTimer);
  translateTimer = setTimeout(processTranslateQueue, 1500);
}
async function processTranslateQueue() {
  if (!S.ld || ls.get('tl_ocrEngine', 'auto') !== 'auto' || !aiReady()) return;
  const lid = S.ledgerId;
  for (const t of Object.values(S.ld.trips)) {
    for (const e of t.expenses.filter((x) => x.translatePending && !translating.has(x.id))) {
      translating.add(e.id);
      try {
        const need = (it) => needsTranslate(it) && it.zhSource !== 'ai' && it.zhSource !== 'user';
        const idx = (e.items || []).map((it, i) => (need(it) ? i : -1)).filter((i) => i >= 0);
        const zh = idx.length ? await aiTranslateNames(idx.map((i) => e.items[i].name), e.title) : [];
        if (S.ledgerId !== lid) return;
        const cur = S.ld.trips[t.trip.id]?.expenses.find((x) => x.id === e.id);
        if (!cur) continue;
        const items = cur.items.map((it, i) => {
          const k = idx.indexOf(i);
          return k >= 0 && it.name === e.items[i]?.name && it.zhSource !== 'user' ? { ...it, nameZh: zh[k], zhSource: 'ai' } : it;
        });
        S.store.updateItem(t.trip.id, 'expenses', e.id, { items, translatePending: false });
      } catch (err) {
        console.warn('翻譯失敗，稍後再試', err);
        translating.delete(e.id);
        return; // 額度用完或沒網路，下次再試
      }
    }
  }
}
window.addEventListener('online', scheduleTranslate);

/* ================= 其他動作 ================= */
function openLedgerMenu() {
  const list = myLedgers();
  openSheet('切換帳本', `
    ${list.map((l) => `<button class="member-line" data-act="switch-ledger" data-id="${esc(l.id)}">
      <span class="trip-flag">📒</span><span class="mid">${esc(l.name)}${l.id === S.ledgerId ? ' <span class="tag">目前</span>' : ''}</span><span class="muted">›</span></button>`).join('')}
    <div class="row2" style="margin-top:14px"><button class="btn secondary" data-act="new-ledger">＋ 建立帳本</button>
      <button class="btn secondary" data-act="join-ledger">加入帳本</button></div>`);
}

async function deleteTrip(tid) {
  const d = tripData(tid);
  if (!d) return;
  if (!confirm(`確定要刪除「${d.trip.name}」？\n所有人的帳目、換匯紀錄、收據照片都會一起刪除，無法復原。`)) return;
  try {
    toast('刪除中…');
    await S.store.deleteTrip(S.ledgerId, tid);
    closeAllSheets();
    S.view = 'ledger';
    render();
    toast('旅程已刪除');
  } catch (err) {
    console.error(err);
    toast('刪除失敗：' + (err?.message || err));
  }
}

async function doExportBackup() {
  const withReceipts = $('#bk-receipts')?.checked;
  try {
    toast('準備備份檔中…');
    const blob = await exportLedger(S.store, S.ld, { withReceipts });
    const name = `旅伴記帳備份-${S.ld.ledger.name}-${new Date().toISOString().slice(0, 10)}.json`;
    await saveFile(name.replace(/[\\/:*?"<>|]/g, '_'), blob);
  } catch (err) {
    console.error(err);
    toast('匯出失敗：' + (err?.message || err));
  }
}
function doImportBackup() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      toast('還原中…');
      const { lid, oldId } = await importLedger(S.store, f, {});
      // 這支手機原本在那本帳本是誰，還原後沿用
      const me = ls.get('tl_me_' + oldId);
      if (me) ls.set('tl_me_' + lid, me);
      openLedger(lid);
      toast('已還原成一本新帳本');
    } catch (err) {
      console.error(err);
      toast('還原失敗：' + (err?.message || err));
    }
  });
  inp.click();
}
function doExportCsv() {
  const trips = allTrips().map((d) => ({ trip: d.trip, rows: calc(d, 'split').rows }))
    .sort((a, b) => (a.trip.startDate || '').localeCompare(b.trip.startDate || ''));
  const name = `旅伴記帳-${S.ld.ledger.name}-${new Date().toISOString().slice(0, 10)}.csv`;
  saveFile(name.replace(/[\\/:*?"<>|]/g, '_'), exportCsv(trips, memberName));
}

/* ================= 事件 ================= */
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  // 表單內自行處理的按鈕
  if (['add-item', 'use-item-sum', 'run-ocr'].includes(el.dataset.act)) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const store = S.store;
  if (el.tagName === 'A') ev.preventDefault();
  switch (act) {
    case 'close-sheet': closeSheet(); break;
    // 帳本
    case 'new-ledger': openLedgerForm(); break;
    case 'join-ledger': openJoin(); break;
    case 'ledger-menu': openLedgerMenu(); break;
    case 'switch-ledger': if (id !== S.ledgerId) openLedger(id); else closeAllSheets(); break;
    case 'ltab': S.ltab = el.dataset.tab; S.view = 'ledger'; render(); window.scrollTo(0, 0); break;
    case 'back': S.view = 'ledger'; render(); break;
    case 'save-ledger-name': {
      const v = $('#ledger-name')?.value.trim();
      if (!v) return;
      store.updateLedger(S.ledgerId, { name: v });
      toast('已儲存');
      break;
    }
    case 'copy-code':
      try { await navigator.clipboard.writeText(S.ledgerId); toast('已複製帳本代碼'); } catch { toast('代碼：' + S.ledgerId); }
      break;
    case 'share': {
      const text = `一起用「旅伴記帳」記帳！\n打開 App →「加入帳本」→ 輸入代碼：${S.ledgerId}\n${el.dataset.url}`;
      try {
        if (navigator.share) { await navigator.share({ text }); return; }
        await navigator.clipboard.writeText(text);
        toast('已複製邀請文字');
      } catch (err) { if (err?.name !== 'AbortError') toast('代碼：' + S.ledgerId); }
      break;
    }
    case 'forget-ledger':
      if (!confirm('從這支手機移除這本帳本？（雲端資料不會刪除，之後可再用代碼加入）')) return;
      forgetLedger(S.ledgerId);
      S.unsub?.(); S.ledgerId = null; S.ld = null;
      if (myLedgers()[0]) openLedger(myLedgers()[0].id); else render();
      break;
    case 'delete-ledger': {
      const name = S.ld.ledger.name;
      if (!confirm(`確定要刪除整本「${name}」？\n裡面 ${Object.keys(S.ld.trips).length} 趟旅程的帳目、收據照片都會刪除，所有成員都看不到，無法復原。`)) return;
      if (prompt(`請輸入帳本名稱「${name}」確認刪除`) !== name) { toast('名稱不符，已取消'); return; }
      try {
        toast('刪除中…');
        const lid = S.ledgerId;
        S.unsub?.(); S.unsub = null;
        await store.deleteLedger(lid);
        forgetLedger(lid);
        S.ledgerId = null; S.ld = null;
        if (myLedgers()[0]) openLedger(myLedgers()[0].id); else render();
        toast('帳本已刪除');
      } catch (err) { toast('刪除失敗：' + (err?.message || err)); }
      break;
    }
    case 'export-backup': doExportBackup(); break;
    case 'import-backup': doImportBackup(); break;
    case 'export-csv': doExportCsv(); break;
    // 成員
    case 'set-me':
      setMe(id);
      if (el.dataset.close) closeSheet();
      render();
      toast(`這支手機的使用者：${memberName(id)}`);
      break;
    case 'add-me': {
      const name = $('#me-new')?.value.trim();
      if (!name) return;
      const m = { id: uid(6), name, avatar: null };
      setMe(m.id); // 先設定再寫入，因為寫入後會立刻重畫
      closeSheet();
      store.updateLedger(S.ledgerId, { members: [...ledgerMembers(), m] });
      break;
    }
    case 'add-member': openMemberForm(null, { toTrip: el.dataset.toTrip ? S.tripId : null }); break;
    case 'edit-member': openMemberForm(id); break;
    case 'remove-member': {
      const inTrips = allTrips().filter((d) => (d.trip.memberIds || []).includes(id));
      if (inTrips.length) { toast(`${memberName(id)} 還在 ${inTrips.length} 趟旅程裡，要先從那些旅程移出`); return; }
      if (ledgerMembers().length <= 1) { toast('帳本至少要有一位成員'); return; }
      if (!confirm(`把 ${memberName(id)} 從帳本移除？`)) return;
      store.updateLedger(S.ledgerId, { members: ledgerMembers().filter((m) => m.id !== id) });
      closeSheet();
      toast('已移除');
      break;
    }
    // 旅程
    case 'new-trip': openTripForm(null); break;
    case 'open-trip': openTrip(id); break;
    case 'edit-trip': openTripForm(tripData().trip); break;
    case 'delete-trip': deleteTrip(id || S.tripId); break;
    case 'toggle-trip-member': {
      const d = tripData();
      const ids = d.trip.memberIds || [];
      if (ids.includes(id)) {
        if (memberUsedInTrip(d, id)) { toast(`${memberName(id)} 在這趟已有帳目，不能移出`); return; }
        if (ids.length <= 1) { toast('至少要有一位旅伴'); return; }
        store.updateTrip(S.tripId, { memberIds: ids.filter((x) => x !== id) });
      } else {
        store.updateTrip(S.tripId, { memberIds: [...ids, id] });
      }
      break;
    }
    case 'tab': S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'filter': S.filter = el.dataset.filter; render(); break;
    case 'settle-mode': store.updateTrip(S.tripId, { settleMode: el.value }); break;
    // 支出
    case 'add-expense': openExpenseForm(); break;
    case 'edit-expense': openExpenseForm(id); break;
    case 'open-expense': openTrip(el.dataset.trip, () => openExpenseForm(id)); break;
    case 'delete-expense': {
      if (!confirm('確定刪除這筆支出？')) return;
      const exp = tripData().expenses.find((x) => x.id === id);
      store.deleteItem(S.tripId, 'expenses', id);
      const rc = exp?.receiptCount ?? (exp?.hasReceipt ? 1 : 0);
      for (let i = 0; i < rc; i++) store.deleteReceipt(S.tripId, receiptKey(id, i)).catch(() => {});
      closeSheet();
      toast('已刪除');
      break;
    }
    case 'save-bill': {
      const input = document.querySelector(`input[data-bill="${CSS.escape(id)}"]`);
      const v = num(input?.value);
      if (v == null || v <= 0) { toast('請輸入台幣出帳金額'); input?.focus(); return; }
      store.updateItem(S.tripId, 'expenses', id, { billedTwd: v, updatedAt: Date.now() });
      toast('已補上出帳金額');
      break;
    }
    // 換匯
    case 'add-exchange': openExchangeForm(); break;
    case 'edit-exchange': openExchangeForm(id); break;
    case 'delete-exchange':
      if (confirm('確定刪除這筆換匯紀錄？')) { store.deleteItem(S.tripId, 'exchanges', id); closeSheet(); toast('已刪除'); }
      break;
    // 搜尋與統計
    case 'quick-search': S.searchQ = el.dataset.q; S.ltab = 'search'; S.view = 'ledger'; render(); break;
    case 'stats-year': S.statsYear = el.dataset.v; render(); break;
    case 'stats-member': S.statsMember = el.dataset.v; render(); break;
    // 設定
    case 'toggle-autoocr': ls.set('tl_autoOcr', el.checked); break;
    case 'ocr-engine': ls.set('tl_ocrEngine', el.value); break;
  }
});

// 搜尋框：邊打字邊更新結果
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'q') return;
  S.searchQ = ev.target.value;
  const box = $('#search-results');
  if (box) box.innerHTML = searchResultsHTML();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'q') ev.target.blur();
  if (ev.key === 'Enter' && ev.target.matches?.('input[data-bill]')) {
    ev.preventDefault();
    document.querySelector(`[data-act="save-bill"][data-id="${CSS.escape(ev.target.dataset.bill)}"]`)?.click();
  }
});

/* ================= 啟動 ================= */
(async function start() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
  try {
    S.store = await createStore();
    S.store.onError = (err) => {
      console.error(err);
      toast(err?.code === 'permission-denied' ? '沒有權限：請檢查 Firestore 規則' : '同步失敗：' + (err?.message || err));
    };
  } catch (err) {
    console.error(err);
    S.fatal = '無法連到雲端資料庫的程式庫。第一次開啟請確認有網路，之後就能離線使用。（' + (err?.message || err) + '）';
    render();
    return;
  }
  const join = new URLSearchParams(location.search).get('join');
  if (join) history.replaceState(null, '', location.pathname);
  const last = ls.get('tl_last');
  const list = myLedgers();
  const target = list.find((l) => l.id === last) || list[0];
  if (target) openLedger(target.id); else render();
  if (join && !list.some((l) => l.id === join)) openJoin(join);
})();
