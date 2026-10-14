// 旅程移動／複製到其他帳本
//   移動：整趟搬過去（帳目、換匯、收據、現金紀錄都跟著走），原帳本就不再有這趟。
//   複製：在目標帳本建一份獨立的副本，收據照片也一起複製；之後兩邊各改各的。
// 兩本帳本的成員各自獨立，所以要先把這趟的每位旅伴「對應」到目標帳本的成員（或新增成員）。
import { S, render, tripData, myLedgers, getMe } from './state.js';
import { uid, receiptKey } from './store.js';
import { $, $$, esc, ls, toast, avatar, openSheet, closeSheet, closeAllSheets } from './ui.js';

const normName = (s) => String(s || '').normalize('NFKC').trim().toLowerCase();

/** 把旅程資料裡的成員 id 換成目標帳本的 id */
export function remapTripData({ trip, expenses, exchanges }, map) {
  const R = (id) => (id && map[id]) || id;
  const keys = (obj) => (obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [R(k), v])) : obj);
  const t = { ...trip, memberIds: (trip.memberIds || []).map(R) };
  if (trip.memberRates) t.memberRates = keys(trip.memberRates);
  if (trip.cash) t.cash = keys(trip.cash);
  if (trip.families) t.families = trip.families.map((f) => ({ ...f, members: (f.members || []).map(R) }));
  const ex = expenses.map((e) => ({
    ...e,
    paidBy: R(e.paidBy),
    participants: (e.participants || []).map(R),
    ...(e.families ? { families: e.families.map((g) => (g.startsWith('m:') ? 'm:' + R(g.slice(2)) : g)) } : {}),
    items: (e.items || []).map((it) => ({ ...it, owners: (it.owners || []).map(R) })),
    ...(e.createdBy ? { createdBy: map[e.createdBy] || null } : {}),
  }));
  const xs = exchanges.map((x) => ({ ...x, member: R(x.member) }));
  return { trip: t, expenses: ex, exchanges: xs };
}

/** 預設對應：同一個 id（例如從備份還原的帳本）→ 同名 → 新增 */
export function defaultMapping(tripMembers, targetMembers) {
  const out = {};
  const used = new Set();
  for (const m of tripMembers) {
    let hit = targetMembers.find((t) => t.id === m.id && !used.has(t.id))
      || targetMembers.find((t) => normName(t.name) === normName(m.name) && !used.has(t.id));
    out[m.id] = hit ? hit.id : 'new';
    if (hit) used.add(hit.id);
  }
  return out;
}

export function openMoveTrip(tid, mode) {
  const d = tripData(tid);
  if (!d) return;
  const verb = mode === 'move' ? '移到' : '複製到';
  if (!d.loaded) { toast('這趟的資料還在同步，請稍候再試'); return; }
  if (S.store.mode === 'firebase' && !navigator.onLine) { toast(`${verb}其他帳本需要網路`); return; }
  const targets = myLedgers().filter((l) => l.id !== S.ledgerId && !l.deletedAt);
  if (!targets.length) {
    openSheet(`${verb}其他帳本`, `
      <p class="muted" style="margin-top:0">這支手機只有目前這一本帳本。請先建立或加入另一本帳本，再回來${verb}那裡。</p>
      <div class="row2"><button class="btn secondary" data-act="new-ledger">＋ 建立帳本</button>
        <button class="btn secondary" data-act="join-ledger">加入帳本</button></div>`);
    return;
  }
  openSheet(`把「${d.trip.name}」${verb}…`, `
    <p class="small muted" style="margin-top:0">${mode === 'move'
      ? '整趟旅程（帳目、換匯、收據、現金紀錄）會搬到選的帳本，目前這本就不再有這趟。'
      : '會在選的帳本建立一份一模一樣的副本，收據照片也會一起複製。之後兩邊各改各的，互不影響。'}</p>
    <div class="small muted" style="margin:10px 0 4px">選擇目標帳本</div>
    ${targets.map((l) => `<button type="button" class="member-line" data-pick-ledger="${esc(l.id)}">
      <span class="trip-flag">📒</span><span class="mid">${esc(l.name)}</span><span class="muted">›</span></button>`).join('')}`, (root) => {
    root.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-pick-ledger]');
      if (!b) return;
      b.disabled = true;
      let target;
      try {
        target = await S.store.getLedger(b.dataset.pickLedger);
      } catch (err) {
        console.error(err);
        toast('讀不到目標帳本，請確認網路後再試');
        b.disabled = false;
        return;
      }
      if (!target || target.deletedAt) { toast('目標帳本不存在或已被刪除'); b.disabled = false; return; }
      closeSheet();
      openMapping(tid, mode, target);
    });
  });
}

function openMapping(tid, mode, target) {
  const d = tripData(tid);
  const tms = target.members || [];
  const def = defaultMapping(d.trip.members, tms);
  const verb = mode === 'move' ? '移到' : '複製到';
  const opts = (m) => `
    ${tms.map((t) => `<option value="${esc(t.id)}" ${def[m.id] === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    <option value="new" ${def[m.id] === 'new' ? 'selected' : ''}>＋ 新增為新成員</option>`;
  openSheet(`${verb}「${target.name}」`, `
    <p class="small muted" style="margin-top:0">兩本帳本的成員是分開的。請確認這趟的每位旅伴，在「${esc(target.name)}」裡是哪一位。同名的已經先幫你對好了。</p>
    <div class="card" style="padding:4px 14px">
      ${d.trip.members.map((m) => `<div class="map-row">
        <span class="h-av">${avatar(m, 26)} ${esc(m.name)}</span><span class="muted">→</span>
        <select data-map="${esc(m.id)}" aria-label="${esc(m.name)} 對應到">${opts(m)}</select></div>`).join('')}
    </div>
    <p class="small muted">${d.expenses.length} 筆帳目、${d.exchanges.length} 筆換匯${d.expenses.some((e) => e.receiptCount || e.hasReceipt) ? '、收據照片' : ''}會一起${mode === 'move' ? '搬過去' : '複製'}。</p>
    ${mode === 'move' ? `<div class="banner" style="margin:0 0 12px">⚠️ 移動後，只加入「${esc(S.ld.ledger.name)}」、沒加入「${esc(target.name)}」的人就看不到這趟了。</div>` : ''}
    <button type="button" class="btn" id="mv-go">${mode === 'move' ? '📦 確定移動' : '📄 確定複製'}</button>`, (root) => {
    $('#mv-go', root).addEventListener('click', async (ev) => {
      const choice = Object.fromEntries($$('select[data-map]', root).map((s) => [s.dataset.map, s.value]));
      const picked = Object.values(choice).filter((v) => v !== 'new');
      if (new Set(picked).size !== picked.length) { toast('兩位旅伴不能對應到同一個人'); return; }
      ev.target.disabled = true;
      try {
        await (mode === 'move' ? doMove : doCopy)(tid, target, choice);
      } catch (err) {
        console.error(err);
        toast(`${verb}失敗：` + (err?.message || err));
        ev.target.disabled = false;
      }
    });
  }, { tall: true });
}

/** 依對應結果算出 id 對照表，並準備要加進目標帳本的新成員 */
function buildMap(d, target, choice) {
  const taken = new Set((target.members || []).map((m) => m.id));
  const map = {};
  const newMembers = [];
  for (const m of d.trip.members) {
    if (choice[m.id] && choice[m.id] !== 'new') { map[m.id] = choice[m.id]; continue; }
    const id = taken.has(m.id) ? uid(6) : m.id;
    taken.add(id);
    newMembers.push({ id, name: m.name, avatar: m.avatar || null });
    map[m.id] = id;
  }
  return { map, newMembers };
}

/** 這支手機在目標帳本還沒選「我是誰」的話，沿用對應過去的人 */
function carryMe(target, map) {
  const me = getMe();
  if (me && map[me] && !ls.get('tl_me_' + target.id)) ls.set('tl_me_' + target.id, map[me]);
}

const raw = (tid) => {
  const t = S.ld.trips[tid];
  return { trip: t.trip, expenses: t.expenses, exchanges: t.exchanges };
};

async function doMove(tid, target, choice) {
  const d = tripData(tid);
  const { map, newMembers } = buildMap(d, target, choice);
  const store = S.store;
  if (newMembers.length) store.updateLedger(target.id, { members: [...(target.members || []), ...newMembers] });
  const src = raw(tid);
  const out = remapTripData(src, map);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // 只更新 id 有變的帳目
  out.expenses.forEach((e, i) => {
    const o = src.expenses[i];
    const patch = {};
    for (const k of ['paidBy', 'participants', 'families', 'items', 'createdBy']) if (k in e && !same(e[k], o[k])) patch[k] = e[k];
    if (Object.keys(patch).length) store.updateItem(tid, 'expenses', o.id, patch);
  });
  out.exchanges.forEach((x, i) => {
    if (x.member !== src.exchanges[i].member) store.updateItem(tid, 'exchanges', x.id, { member: x.member });
  });
  const tp = {};
  for (const k of ['memberIds', 'memberRates', 'cash', 'families']) if (k in out.trip && !same(out.trip[k], src.trip[k])) tp[k] = out.trip[k];
  if (Object.keys(tp).length) store.updateTrip(tid, tp);
  if (S.tripId === tid) { S.view = 'ledger'; S.tripId = null; }
  await store.moveTrip(tid, S.ledgerId, target.id);
  carryMe(target, map);
  closeAllSheets();
  render();
  done(`已把「${d.trip.name}」移到「${target.name}」`, target);
}

async function doCopy(tid, target, choice) {
  const d = tripData(tid);
  const { map, newMembers } = buildMap(d, target, choice);
  const store = S.store;
  if (newMembers.length) store.updateLedger(target.id, { members: [...(target.members || []), ...newMembers] });
  const src = raw(tid);
  const out = remapTripData(src, map);
  const { id: _i, ledgerId: _l, deletedAt: _d, deletedBy: _b, ...fields } = out.trip; // eslint-disable-line no-unused-vars
  const newTid = store.createTrip(target.id, {
    ...fields, createdAt: Date.now(), copiedFrom: { ledgerId: S.ledgerId, tripId: tid, at: Date.now() },
  });
  let nReceipt = 0, failed = 0;
  const total = out.expenses.reduce((a, e) => a + (e.receiptCount ?? (e.hasReceipt ? 1 : 0)), 0);
  for (const e of out.expenses) {
    const { id: oldId, ...rest } = e;
    const newId = store.newId();
    store.addItem(newTid, 'expenses', rest, newId);
    const cnt = e.receiptCount ?? (e.hasReceipt ? 1 : 0);
    for (let i = 0; i < cnt; i++) {
      try {
        const url = await store.getReceipt(tid, receiptKey(oldId, i));
        if (url) await store.saveReceipt(newTid, receiptKey(newId, i), url); else failed++;
      } catch (err) { console.warn(err); failed++; }
      nReceipt++;
      if (total > 3) toast(`複製收據照片 ${nReceipt}/${total}…`);
    }
  }
  for (const x of out.exchanges) {
    const { id: _x, ...rest } = x; // eslint-disable-line no-unused-vars
    store.addItem(newTid, 'exchanges', rest);
  }
  carryMe(target, map);
  closeAllSheets();
  done(`已把「${d.trip.name}」複製到「${target.name}」${failed ? `（有 ${failed} 張收據照片讀不到，沒有複製）` : ''}`, target);
}

function done(msg, target) {
  openSheet('完成', `
    <p style="margin-top:0">✅ ${esc(msg)}</p>
    <div class="row2"><button class="btn" data-act="switch-ledger" data-id="${esc(target.id)}">切換到「${esc(target.name)}」</button>
      <button class="btn secondary" data-act="close-sheet">留在這裡</button></div>`);
}
