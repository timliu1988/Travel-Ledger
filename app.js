// 旅伴記帳 v5.3 — 主程式：畫面切換、按鈕事件、啟動
import { createStore, uid, receiptKey } from './store.js';
import { calc } from './calc.js';
import { aiReady, aiTranslateNames, aiDiagnose } from './ai.js';
import { fmtRange } from './calendar.js';
import {
  S, hooks, render, myLedgers, rememberLedger, forgetLedger, getMe, setMe, member, memberName, ledgerMembers, tripData, allTrips,
  deletedTrips, daysLeft, TRASH_DAYS,
} from './state.js';
import { $, $$, esc, flag, num, ls, toast, avatar, closeSheet, closeAllSheets, saveFile, openSheet } from './ui.js';
import { welcomeHTML, tripsTab, searchTab, searchResultsHTML, statsTab, ledgerSettingsTab } from './views-ledger.js';
import { listTab, tripRowsHTML, settleTab, exchangeTab, tripSettingsTab, previousTripSameCurrency } from './views-trip.js';
import {
  nav, needsTranslate, memberUsedInTrip, openTripForm, openMemberForm, openExpenseForm, openFamilyForm, openExchangeForm,
  openLedgerForm, openJoin, openWhoAmI, openRenameLedger, openRateForm, openCashForm,
} from './forms.js';
import { exportLedger, importLedger, exportCsv } from './backup.js';
import { initUpdates, checkNow } from './update.js';
import { openMoveTrip } from './move.js';
import { applyTheme, setTheme, setMode } from './theme.js';

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

  if (S.ld.ledger.deletedAt) {
    const left = daysLeft(S.ld.ledger.deletedAt);
    app.innerHTML = `<header class="top"><button class="titles ledger-switch" data-act="ledger-menu"><h1>${esc(S.ld.ledger.name)} <span class="caret">▾</span></h1>
        <div class="sub">已刪除</div></button></header>
      <main><div class="card">
        <h3>🗑 這本帳本已被刪除</h3>
        <p class="small">${new Date(S.ld.ledger.deletedAt).toLocaleDateString('zh-TW')} 由 ${esc(memberName(S.ld.ledger.deletedBy) || '某位成員')} 刪除。還剩 <b>${left} 天</b>可以復原，之後會永久刪除。</p>
        <button class="btn" data-act="restore-ledger">↩︎ 復原帳本</button>
        <button class="btn danger" data-act="purge-ledger">立即永久刪除</button>
        <button class="btn secondary" data-act="forget-ledger">從這支手機移除</button>
      </div></main>`;
    return;
  }

  if (S.view === 'trip') {
    const d = tripData();
    if (!d || d.trip.deletedAt) { S.view = 'ledger'; return draw(); }
    const { trip } = d;
    const body = { list: listTab, settle: settleTab, exchange: exchangeTab, settings: tripSettingsTab }[S.tab](d);
    const tabs = [['list', '📒', '帳目'], ['settle', '🤝', '結算'], ['exchange', '💱', '換匯'], ['settings', '⚙️', '設定']];
    app.innerHTML = `
      <header class="top">
        <button class="icon-btn" data-act="back" aria-label="回到帳本">‹</button>
        <button class="titles title-btn" data-act="edit-trip" aria-label="編輯旅程"><h1>${flag(trip.currency)} ${esc(trip.name)} <span class="caret">✎</span></h1>
          <div class="sub">${trip.startDate ? esc(fmtRange(trip.startDate, trip.endDate)) + ' · ' : ''}${trip.members.length} 人 · ${esc(trip.currency)}</div></button>
        ${S.tab === 'list' ? `<button class="icon-btn search-btn ${S.tripSearch ? 'on' : ''}" data-act="trip-search" aria-label="搜尋這一趟">🔍</button>` : ''}
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
          <div class="sub">${ledgerMembers().length} 位成員 · ${allTrips().length} 趟旅程</div></button>
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
    const typing = ['q', 'tq'].includes(document.activeElement?.id);
    S.ld = ld;
    rememberLedger(id, ld.ledger.name, ld.ledger.deletedAt || null);
    if (S.view === 'trip' && (!ld.trips[S.tripId] || ld.trips[S.tripId].trip.deletedAt) && !ld.pending) { S.view = 'ledger'; toast('這趟旅程已被刪除'); }
    purgeExpired();
    if (typing) {
      const box = $('#search-results'); if (box) box.innerHTML = searchResultsHTML();
      const tr = $('#trip-rows'); if (tr && tripData()) tr.innerHTML = tripRowsHTML(tripData());
    } else render();
    if (!S.askedMe && !ledgerMembers().some((m) => m.id === getMe())) { S.askedMe = true; openWhoAmI(); }
    if (Object.values(ld.trips).some((t) => t.expenses.some((x) => x.translatePending))) scheduleTranslate();
  });
}
function openTrip(tid, then) {
  S.tripId = tid;
  S.view = 'trip';
  S.tab = 'list';
  S.filter = 'all';
  S.tripSearch = false;
  S.tripQ = '';
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
      <span class="trip-flag">📒</span><span class="mid">${esc(l.name)}${l.id === S.ledgerId ? ' <span class="tag">目前</span>' : ''}${l.deletedAt ? ` <span class="tag warn">已刪除・剩 ${daysLeft(l.deletedAt)} 天</span>` : ''}</span><span class="muted">›</span></button>`).join('')}
    ${S.ld && !S.ld.ledger.deletedAt ? '<button class="btn secondary" data-act="rename-ledger" style="margin-top:12px">✏️ 編輯目前帳本的名稱</button>' : ''}
    <div class="row2" style="margin-top:12px"><button class="btn secondary" data-act="new-ledger">＋ 建立帳本</button>
      <button class="btn secondary" data-act="join-ledger">加入帳本</button></div>`);
}

function openTripMenu(tid) {
  const d = tripData(tid);
  if (!d) return;
  openSheet(d.trip.name, `
    <button class="btn secondary" data-act="menu-open" data-id="${esc(tid)}">打開旅程</button>
    <button class="btn secondary" data-act="edit-trip" data-id="${esc(tid)}">✏️ 編輯旅程（名稱、日期、幣別、旅伴）</button>
    <button class="btn secondary" data-act="move-trip" data-id="${esc(tid)}">📦 移到其他帳本</button>
    <button class="btn secondary" data-act="copy-trip" data-id="${esc(tid)}">📄 複製到其他帳本</button>
    <button class="btn danger" data-act="delete-trip" data-id="${esc(tid)}">🗑 刪除旅程</button>`);
}

/** 要求輸入名稱才能刪除，避免誤按 */
function confirmByName(kind, name, extra) {
  if (!confirm(`確定要刪除${kind}「${name}」？\n${extra}`)) return false;
  const typed = prompt(`請輸入${kind}名稱「${name}」確認刪除`);
  if (typed == null) return false;
  if (typed.trim() !== name.trim()) { toast('名稱不符，已取消'); return false; }
  return true;
}

function deleteTrip(tid) {
  const d = tripData(tid);
  if (!d) return;
  if (!confirmByName('旅程', d.trip.name, `刪除後會放進「最近刪除」保留 ${TRASH_DAYS} 天，期間可以復原。`)) return;
  S.store.updateTrip(tid, { deletedAt: Date.now(), deletedBy: getMe() || null });
  closeAllSheets();
  S.view = 'ledger';
  render();
  toast(`已移到最近刪除（${TRASH_DAYS} 天內可復原）`);
}

/* ---------- 最近刪除 ---------- */
function openTrash() {
  const list = deletedTrips().sort((a, b) => b.trip.deletedAt - a.trip.deletedAt);
  openSheet('最近刪除', `
    <p class="small muted" style="margin-top:0">刪除的旅程保留 ${TRASH_DAYS} 天，之後會自動永久刪除。</p>
    ${list.length ? list.map((d) => `
      <div class="trash-row">
        <div><b>${flag(d.trip.currency)} ${esc(d.trip.name)}</b>
          <div class="small muted">${new Date(d.trip.deletedAt).toLocaleDateString('zh-TW')} ${d.trip.deletedBy ? esc(memberName(d.trip.deletedBy)) + ' ' : ''}刪除・剩 ${daysLeft(d.trip.deletedAt)} 天・${d.expenses.length} 筆帳目</div></div>
        <div class="trash-btns">
          <button class="btn small" data-act="restore-trip" data-id="${esc(d.trip.id)}">復原</button>
          <button class="btn small danger" data-act="purge-trip" data-id="${esc(d.trip.id)}">永久刪除</button>
        </div>
      </div>`).join('') + '<button class="btn danger" data-act="purge-all" style="margin-top:14px">全部清空</button>' : '<div class="empty">沒有最近刪除的旅程</div>'}`);
}
async function purgeTrips(tids) {
  try {
    toast('永久刪除中…');
    for (const tid of tids) await S.store.deleteTrip(S.ledgerId, tid);
    toast('已永久刪除');
  } catch (err) {
    console.error(err);
    toast('刪除失敗：' + (err?.message || err));
  }
}
/** 打開帳本時，順便清掉超過 30 天的 */
let purging = false;
async function purgeExpired() {
  if (purging || !S.ld) return;
  const limit = Date.now() - TRASH_DAYS * 86400000;
  const lid = S.ledgerId;
  purging = true;
  try {
    if (S.ld.ledger.deletedAt && S.ld.ledger.deletedAt < limit) {
      S.unsub?.(); S.unsub = null;
      await S.store.deleteLedger(lid);
      forgetLedger(lid);
      S.ledgerId = null; S.ld = null;
      if (myLedgers()[0]) openLedger(myLedgers()[0].id); else render();
      return;
    }
    const old = deletedTrips().filter((d) => d.trip.deletedAt < limit).map((d) => d.trip.id);
    for (const tid of old) await S.store.deleteTrip(lid, tid);
  } catch (err) {
    console.warn('清除過期資料失敗，下次再試', err);
  } finally {
    purging = false;
  }
}

/** 把上一趟同幣別旅程剩下的現金，帶成這趟的期初現金 */
function carryCash(prevTripId) {
  const d = tripData();
  const prev = tripData(prevTripId);
  if (!d || !prev) return;
  const pc = calc(prev, 'split');
  const patch = {};
  for (const m of d.trip.members) {
    const cc = pc.cashCheck[m.id];
    if (!cc || !cc.used || ((d.trip.cash || {})[m.id]?.opening)) continue;
    const left = cc.counted ?? cc.expected;
    if (!(left > 0)) continue;
    const r = pc.rates.memberRate[m.id];
    patch[`cash.${m.id}`] = { ...((d.trip.cash || {})[m.id] || {}), opening: left, openingTwd: r ? Math.round(left * r) : null, openingFrom: `${prev.trip.name}剩下的` };
  }
  if (!Object.keys(patch).length) return;
  S.store.updateTrip(d.trip.id, patch);
  toast('已帶入期初現金');
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
      if (!confirmByName('帳本', name, `裡面有 ${allTrips().length} 趟旅程。刪除後會保留 ${TRASH_DAYS} 天，期間所有成員都可以復原。`)) return;
      store.updateLedger(S.ledgerId, { deletedAt: Date.now(), deletedBy: getMe() || null });
      toast(`帳本已刪除（${TRASH_DAYS} 天內可復原）`);
      break;
    }
    case 'restore-ledger':
      store.updateLedger(S.ledgerId, { deletedAt: null, deletedBy: null });
      toast('帳本已復原');
      break;
    case 'purge-ledger': {
      if (!confirm(`立即永久刪除「${S.ld.ledger.name}」？刪除後無法復原。`)) return;
      try {
        toast('永久刪除中…');
        const lid = S.ledgerId;
        S.unsub?.(); S.unsub = null;
        await store.deleteLedger(lid);
        forgetLedger(lid);
        S.ledgerId = null; S.ld = null;
        if (myLedgers()[0]) openLedger(myLedgers()[0].id); else render();
        toast('帳本已永久刪除');
      } catch (err) { toast('刪除失敗：' + (err?.message || err)); }
      break;
    }
    case 'rename-ledger': closeAllSheets(); openRenameLedger(); break;
    case 'open-trash': openTrash(); break;
    case 'restore-trip':
      store.updateTrip(id, { deletedAt: null, deletedBy: null });
      closeSheet();
      toast('旅程已復原');
      break;
    case 'purge-trip': {
      const d = tripData(id);
      if (!confirm(`永久刪除「${d?.trip.name}」？刪除後無法復原。`)) return;
      closeSheet();
      purgeTrips([id]);
      break;
    }
    case 'purge-all': {
      const ids = deletedTrips().map((d) => d.trip.id);
      if (!ids.length || !confirm(`永久刪除最近刪除裡的 ${ids.length} 趟旅程？刪除後無法復原。`)) return;
      closeSheet();
      purgeTrips(ids);
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
    case 'edit-trip': { closeAllSheets(); const d = tripData(id || S.tripId); if (d) openTripForm(d.trip); break; }
    case 'trip-menu': openTripMenu(id); break;
    case 'menu-open': openTrip(id); break;
    case 'edit-rate': openRateForm(id); break;
    case 'edit-cash': openCashForm(id); break;
    case 'carry-cash': carryCash(id); break;
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
    case 'trip-search':
      S.tripSearch = !S.tripSearch;
      if (!S.tripSearch) S.tripQ = '';
      render();
      if (S.tripSearch) setTimeout(() => $('#tq')?.focus(), 50);
      break;
    case 'goto-noamount': S.tab = 'list'; S.filter = 'noamount'; render(); window.scrollTo(0, 0); break;
    case 'settle-view': S.settleView = el.value; render(); break;
    case 'family-form': closeAllSheets(); openFamilyForm(); break;
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
    case 'toggle-keepreceipt': ls.set('tl_keepReceipt', el.checked); toast(el.checked ? '收據照片會跟著帳目保存' : '之後拍的收據照片只用來辨識，不會保存'); break;
    case 'ocr-engine': ls.set('tl_ocrEngine', el.value); break;
    case 'ai-test': {
      const box = $('#ai-test-out');
      if (!box) return;
      el.disabled = true;
      box.innerHTML = '<p class="small muted">測試中，每個模型約需幾秒…</p>';
      const list = await aiDiagnose();
      el.disabled = false;
      box.innerHTML = `<div class="ai-test">${list.map((x) => `<div class="ai-row ${x.ok ? 'ok' : 'bad'}"><b>${x.ok ? '✅' : '❌'} ${esc(x.model)}</b><span>${esc(x.msg)}</span></div>`).join('')}</div>
        <p class="small muted">${list.some((x) => x.ok) ? '有可以用的模型，收據辨識會自動用它。' : '全部失敗。可以把這個畫面截圖給我，看錯誤訊息判斷是哪裡沒設定好。'}</p>`;
      break;
    }
    case 'check-update': {
      toast('檢查中…');
      const r = await checkNow();
      toast({ found: '找到新版本，下載好會出現「點此更新」', latest: '已經是最新版', offline: '目前沒有網路', unsupported: '這個瀏覽器不支援自動更新' }[r] || '');
      break;
    }
    case 'set-theme': setTheme(id); render(); break;
    case 'set-mode': setMode(el.value); render(); break;
    case 'move-trip': closeAllSheets(); openMoveTrip(id, 'move'); break;
    case 'copy-trip': closeAllSheets(); openMoveTrip(id, 'copy'); break;
  }
});

// 搜尋框：邊打字邊更新結果
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'tq') {
    S.tripQ = ev.target.value;
    const box = $('#trip-rows');
    const d = tripData();
    if (box && d) box.innerHTML = tripRowsHTML(d);
    return;
  }
  if (ev.target.id !== 'q') return;
  S.searchQ = ev.target.value;
  const box = $('#search-results');
  if (box) box.innerHTML = searchResultsHTML();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.target.id === 'q' || ev.target.id === 'tq')) ev.target.blur();
  if (ev.key === 'Enter' && ev.target.matches?.('input[data-bill]')) {
    ev.preventDefault();
    document.querySelector(`[data-act="save-bill"][data-id="${CSS.escape(ev.target.dataset.bill)}"]`)?.click();
  }
});

/* ================= 啟動 ================= */
(async function start() {
  applyTheme(); // 外觀主題（樣式檔已由 index.html 先載入，這裡啟用線條圖示和自動切換深淺色）
  initUpdates(); // 背景檢查新版本，不擋啟動
  try {
    S.store = await createStore();
    S.store.onError = (err) => {
      console.error(err);
      toast(err?.code === 'permission-denied' ? (S.store?.appCheck ? '沒有權限：請檢查 Firestore 規則或 App Check 設定' : '沒有權限：請檢查 Firestore 規則') : '同步失敗：' + (err?.message || err));
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
