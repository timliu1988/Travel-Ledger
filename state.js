// App 的共用狀態
import { ls } from './ui.js';

export const S = {
  store: null,
  fatal: null,
  ledgerId: null,
  ld: null,          // { ledger, trips: { tid: { trip, expenses, exchanges, loaded } }, pending }
  unsub: null,
  view: 'ledger',    // ledger | trip
  ltab: 'trips',     // 帳本頁籤：trips | search | stats | settings
  tripId: null,
  tab: 'list',       // 旅程頁籤：list | settle | exchange | settings
  filter: 'all',
  tripSearch: false, // 旅程內搜尋框是否打開
  tripQ: '',
  searchQ: '',
  statsYear: 'all',
  statsMember: 'all',
  askedMe: false,
};

// 畫面重畫由 app.js 提供，其他模組透過這個呼叫
export const hooks = { render: () => {} };
export const render = () => hooks.render();

/* ---------- 這支手機記住的帳本 ---------- */
export const myLedgers = () => ls.get('tl_ledgers', []);
export function rememberLedger(id, name, deletedAt) {
  const list = myLedgers();
  const old = list.find((x) => x.id === id);
  if (old) {
    const nd = deletedAt === undefined ? old.deletedAt : (deletedAt || null);
    if ((name && old.name !== name) || old.deletedAt !== nd) { if (name) old.name = name; old.deletedAt = nd; ls.set('tl_ledgers', list); }
    return;
  }
  list.push({ id, name: name || '帳本', addedAt: Date.now(), deletedAt: deletedAt || null });
  ls.set('tl_ledgers', list);
}
export function forgetLedger(id) {
  ls.set('tl_ledgers', myLedgers().filter((x) => x.id !== id));
  ls.del('tl_me_' + id);
  if (ls.get('tl_last') === id) ls.del('tl_last');
}

/* ---------- 「我是誰」：每本帳本各記一次 ---------- */
export const getMe = () => (S.ledgerId ? ls.get('tl_me_' + S.ledgerId) : null);
export const setMe = (id) => ls.set('tl_me_' + S.ledgerId, id);

/* ---------- 帳本成員 ---------- */
export const ledgerMembers = () => S.ld?.ledger.members || [];
export const member = (id) => ledgerMembers().find((m) => m.id === id);
export const memberName = (id) => member(id)?.name ?? '（已移除）';

/** 某趟旅程的資料，trip.members 是這趟的同行旅伴（從帳本成員帶入） */
export function tripData(tid = S.tripId) {
  const t = S.ld?.trips[tid];
  if (!t) return null;
  const ids = t.trip.memberIds || [];
  const members = ledgerMembers().filter((m) => ids.includes(m.id));
  return { trip: { ...t.trip, members }, expenses: t.expenses, exchanges: t.exchanges, loaded: t.loaded };
}
/** 目前的旅程（不含「最近刪除」裡的） */
export const allTrips = () => Object.keys(S.ld?.trips || {}).map((tid) => tripData(tid)).filter((d) => d && !d.trip.deletedAt);
/** 「最近刪除」裡的旅程 */
export const deletedTrips = () => Object.keys(S.ld?.trips || {}).map((tid) => tripData(tid)).filter((d) => d && d.trip.deletedAt);
export const TRASH_DAYS = 30;
export const daysLeft = (deletedAt) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - deletedAt) / 86400000));
