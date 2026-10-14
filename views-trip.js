// 單一旅程的四個頁籤：帳目、結算、換匯、設定
import { S, getMe, member, memberName, ledgerMembers, allTrips } from './state.js';
import { calc, decimals, tripGroups } from './calc.js';
import { norm } from './search.js';
import { fmtRange, tripDays } from './calendar.js';
import {
  CATS, catOf, flag, curName, esc, fmt, twd, fx, money, moneyMulti, moneyLines, rateStr, dayLabel, avatar,
} from './ui.js';

const RATE_SRC = { manual: '手動設定', own: '自己的換匯平均', trip: '這趟預設匯率', all: '全體換匯平均', est: '刷卡預估匯率' };

/** 每位旅伴的匯率清單 */
function memberRatesHTML(trip, c) {
  return trip.members.map((m) => {
    const r = c.rates.memberRate[m.id];
    return `<div class="kv rate-row"><span class="k h-av">${avatar(m, 22)} ${esc(m.name)}</span>
      <span class="v">${r ? `${rateStr(r)} <small class="muted">${RATE_SRC[c.rates.memberRateSource[m.id]] || ''}</small>` : '<span class="muted">未設定</span>'}
      <button class="btn small secondary" data-act="edit-rate" data-id="${esc(m.id)}">設定</button></span></div>`;
  }).join('');
}

/** 同幣別的上一趟旅程（用來把剩下的外幣現金帶過來） */
export function previousTripSameCurrency(trip) {
  return allTrips()
    .filter((d) => d.trip.id !== trip.id && d.trip.currency === trip.currency
      && (d.trip.endDate || d.trip.startDate || '') <= (trip.startDate || '9999') && (d.trip.startDate || ''))
    .sort((a, b) => (b.trip.endDate || b.trip.startDate || '').localeCompare(a.trip.endDate || a.trip.startDate || ''))[0] || null;
}

/** 家庭名稱（自己一家的就用旅伴名字） */
const groupName = (g) => (g.solo ? memberName(g.members[0]) : g.name);
const groupIcon = (g, size) => (g.solo ? avatar(member(g.members[0]), size) : `<span class="fam-ic" style="width:${size}px;height:${size}px">🏠</span>`);
function famBalanceHTML(c, gid) {
  const parts = c.settlements.map((s) => {
    const v = s.famBalances.find((b) => b.id === gid)?.v || 0;
    const eps = decimals(s.cur) ? 0.005 : 0.5;
    if (v >= eps) return `<span class="pos">應收 ${money(v, s.cur)}</span>`;
    if (v <= -eps) return `<span class="neg">應付 ${money(-v, s.cur)}</span>`;
    return '';
  }).filter(Boolean);
  return parts.length ? parts.join('<br>') : '已平衡';
}
const sumCur = (list) => { const o = {}; for (const x of list) for (const [k, v] of Object.entries(x)) o[k] = (o[k] || 0) + v; return o; };

const SETTLE_LABEL = (cur) => ({ split: '分幣別', twd: '全換台幣', local: `全換${curName(cur)}` });

/** 每個人在各種結算下的應收/應付（可能有多個幣別） */
function balanceHTML(c, id) {
  const parts = c.settlements.map((s) => {
    const v = s.balances.find((b) => b.id === id)?.v || 0;
    const eps = decimals(s.cur) ? 0.005 : 0.5;
    if (v >= eps) return `<span class="pos">應收 ${money(v, s.cur)}</span>`;
    if (v <= -eps) return `<span class="neg">應付 ${money(-v, s.cur)}</span>`;
    return '';
  }).filter(Boolean);
  return parts.length ? parts.join('<br>') : '已平衡';
}

function peopleSummary(d, c) {
  const { trip } = d;
  const me = getMe();
  return `
    <div class="people ${trip.members.length > 4 ? 'compact' : ''}">
      ${trip.members.map((m) => {
        const p = c.per[m.id];
        return `<div class="person ${m.id === me ? 'me' : ''}">
          <div class="p-head">${avatar(m, 28)}<span class="p-name">${esc(m.name)}</span></div>
          <div class="p-total">${moneyLines(p.share)}</div>
          ${Object.keys(p.share).some((k) => k !== 'TWD') && p.shareTwd ? `<div class="p-sub">≈ ${twd(p.shareTwd)}${p.shareNoRate ? ' 起' : ''}</div>` : ''}
          <div class="p-bal">${balanceHTML(c, m.id)}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="trip-total">
      <span>全團 <b>${moneyMulti(c.byCur)}</b></span>
      ${c.curs.some((k) => k !== 'TWD') && c.totalTwd ? `<span class="muted">≈ ${twd(c.totalTwd)}${c.noRate ? ' 起' : ''}</span>` : ''}
    </div>
    <div class="small muted settle-note">結算方式：${SETTLE_LABEL(trip.currency)[c.mode]}${c.mode !== c.requestedMode ? '（缺結算匯率，暫用分幣別）' : ''} · <a href="#" data-act="tab" data-tab="settle">切換</a></div>`;
}

/* ---------- 帳目 ---------- */
/** 這一趟裡的搜尋：店名／項目、品項（原文、中文）、備註、付款人、分類、金額，空白分開的每個字都要符合 */
export function tripSearchMatch(r, q) {
  const words = String(q || '').trim().split(/\s+/).map(norm).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.title, r.note, memberName(r.paidBy), catOf(r.category).name, r.amountPending ? '金額待補' : String(r.amount),
    ...(r.items || []).flatMap((it) => [it.name, it.nameZh])].map(norm).join('|');
  return words.every((w) => hay.includes(w));
}

/** 帳目清單本體（搜尋時只重畫這一塊，鍵盤才不會收起來） */
export function tripRowsHTML(d) {
  const { trip } = d;
  const c = calc(d, trip.settleMode || 'split');
  let rows = c.rows;
  if (S.filter === 'pending') rows = rows.filter(c.isPendingBill);
  if (S.filter === 'noamount') rows = rows.filter(c.isNoAmount);
  const q = S.tripSearch ? S.tripQ.trim() : '';
  if (q) rows = rows.filter((r) => tripSearchMatch(r, q));
  rows = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.date === r.date) g.items.push(r); else groups.push({ date: r.date, items: [r] });
  }
  const days = tripDays(trip.startDate, trip.endDate);

  const itemHTML = (r) => {
    const cat = catOf(r.category);
    const ids = Object.keys(r.fractions);
    let split;
    if (r.splitMode === 'self') split = `${esc(memberName(r.paidBy))} 個人`;
    else if (r.splitMode === 'items') split = '逐項分';
    else if (r.splitMode === 'family') { const n = (r.families || []).length; split = n ? `${n} 家分` : '按家庭'; }
    else if (ids.length === trip.members.length && ids.length > 1) split = '大家分';
    else if (ids.length === 1) split = `${esc(memberName(ids[0]))}自己`;
    else split = `${ids.length} 人分`;
    let sub = '';
    if (r.val.kind === 'noamount') sub = '<span class="tag warn">金額待補</span>';
    else if (r.val.kind === 'billed') sub = `${twd(r.billedTwd)} <span class="tag">已出帳</span>`;
    else if (r.val.kind === 'pending') sub = `${r.val.twd != null ? '≈ ' + twd(r.val.twd) + ' ' : ''}<span class="tag warn">待出帳</span>`;
    else if (r.val.kind === 'cash' && r.val.twd != null) sub = `≈ ${twd(r.val.twd)}`;
    const names = (r.items || []).map((it) => it.nameZh || it.name).filter(Boolean);
    const rc = r.receiptCount ?? (r.hasReceipt ? 1 : 0);
    let html = `
      <button class="item" data-act="edit-expense" data-id="${esc(r.id)}">
        <span class="ic">${cat.icon}<span class="ic-av">${avatar(member(r.paidBy), 18)}</span>${rc ? `<span class="ic-rc" aria-label="有 ${rc} 張收據照片">🧾${rc > 1 ? `<b>${rc}</b>` : ''}</span>` : ''}</span>
        <span class="mid"><div class="t">${esc(r.title || cat.name)}</div>
          <div class="s">${r.method === 'card' ? '💳' : '💵'} ${esc(memberName(r.paidBy))}付 · ${split}</div>
          ${names.length ? `<div class="s s2">${esc(names.slice(0, 4).join('、'))}${names.length > 4 ? `…等 ${names.length} 項` : ''}${r.translatePending ? ' <span class="tag warn">待翻譯</span>' : ''}</div>` : ''}</span>
        <span class="amt"><div class="f"><span class="fl">${flag(r.currency)}</span>${r.amountPending ? '<span class="muted">—</span>' : money(r.amount, r.currency)}</div><div class="tw">${sub}</div></span>
      </button>`;
    if (S.filter === 'pending') {
      html += `<div class="bill"><input inputmode="decimal" placeholder="帳單台幣金額" data-bill="${esc(r.id)}" aria-label="台幣出帳金額">
        <button class="btn small" data-act="save-bill" data-id="${esc(r.id)}">儲存</button></div>`;
    }
    return html;
  };
  const empty = q ? `找不到符合「${esc(q)}」的帳目`
    : S.filter === 'pending' ? '刷卡帳目都已補上台幣金額 👍' : S.filter === 'noamount' ? '金額都補齊了 👍' : '還沒有帳目，按右下角 ＋ 新增第一筆';
  return `${q ? `<div class="small muted" style="margin:4px 2px 8px">找到 ${rows.length} 筆</div>` : ''}
    ${groups.length ? groups.map((g) => {
      const dayCur = {};
      g.items.forEach((r) => { dayCur[r.val.cur] = (dayCur[r.val.cur] || 0) + r.val.amt; });
      const di = days.indexOf(g.date);
      return `<div class="day"><span>${g.date ? dayLabel(g.date) : '未填日期'}${di >= 0 ? ` · Day ${di + 1}` : ''}</span><span class="num">${Object.values(dayCur).some((v) => Math.abs(v) >= 0.005) ? moneyMulti(dayCur, false) : ''}</span></div>
        <div class="list">${g.items.map(itemHTML).join('')}</div>`;
    }).join('') : `<div class="list"><div class="empty">${empty}</div></div>`}`;
}

export function listTab(d) {
  const { trip } = d;
  const c = calc(d, trip.settleMode || 'split');
  const searching = S.tripSearch;
  return `
    ${searching ? `<div class="search-box trip-search"><input type="search" id="tq" value="${esc(S.tripQ)}" placeholder="搜尋這一趟：店名、品項、備註、金額" autocomplete="off" enterkeyhint="search"></div>` : ''}
    ${searching && S.tripQ.trim() ? '' : peopleSummary(d, c)}
    ${!searching && c.noAmountN && S.filter !== 'noamount' ? `<button class="banner" data-act="filter" data-filter="noamount">✏️ 有 ${c.noAmountN} 筆還沒填金額，補上後才會算進結算 ›</button>` : ''}
    ${!searching && c.pendingN && S.filter !== 'pending' ? `<button class="banner" data-act="filter" data-filter="pending">💳 有 ${c.pendingN} 筆刷卡還沒補台幣出帳金額 ›</button>` : ''}
    <div class="chips">
      <button class="chip ${S.filter === 'all' ? 'on' : ''}" data-act="filter" data-filter="all">全部</button>
      <button class="chip ${S.filter === 'pending' ? 'on' : ''}" data-act="filter" data-filter="pending">待補出帳 ${c.pendingN ? `(${c.pendingN})` : ''}</button>
      ${c.noAmountN || S.filter === 'noamount' ? `<button class="chip ${S.filter === 'noamount' ? 'on' : ''}" data-act="filter" data-filter="noamount">金額待補 ${c.noAmountN ? `(${c.noAmountN})` : ''}</button>` : ''}
    </div>
    <div id="trip-rows">${tripRowsHTML(d)}</div>`;
}

/* ---------- 結算 ---------- */
export function settleTab(d) {
  const { trip } = d;
  const c = calc(d, trip.settleMode || 'split');
  const members = trip.members;
  const me = getMe();
  const lbl = SETTLE_LABEL(trip.currency);
  const usedCats = CATS.filter((cat) => members.some((m) => c.per[m.id].cats[cat.id]));
  const famOn = !!trip.familyMode;
  const view = famOn && S.settleView === 'family' ? 'family' : 'person';
  return `
    <div class="card">
      <h3>結算方式</h3>
      <div class="seg">${['split', 'twd', 'local'].map((k) => `
        <label class="opt"><input type="radio" name="settleMode" value="${k}" data-act="settle-mode" ${(trip.settleMode || 'split') === k ? 'checked' : ''}><span>${lbl[k]}</span></label>`).join('')}</div>
      <p class="small muted" style="margin:8px 0 0">${{
        split: '外幣現金用外幣結、刷卡出帳和台幣支出用台幣結，不做換算。',
        twd: '每一筆外幣用「付款人」的匯率換成台幣，最後只結一筆台幣。',
        local: `每一筆台幣用「付款人」的匯率換成${curName(trip.currency)}，最後只結一筆${curName(trip.currency)}。`,
      }[trip.settleMode || 'split']}</p>
      ${(trip.settleMode || 'split') !== 'split' ? `<div class="rate-list"><div class="small muted" style="margin:8px 0 2px">每個人的匯率（1 ${esc(trip.currency)} = ? TWD）</div>${memberRatesHTML(trip, c)}</div>` : ''}
      ${c.mode !== c.requestedMode ? `<div class="banner" style="margin:8px 0 0">有人還沒有匯率，或這趟有第三種幣別的支出，暫時用分幣別結算。請到「換匯」新增紀錄或設定匯率。</div>` : ''}
    </div>
    ${c.noAmountN ? `<button class="banner" data-act="goto-noamount">⚠️ 有 ${c.noAmountN} 筆「金額待補」還沒算進結算，補上金額後結果會改變 ›</button>` : ''}
    ${c.pendingN ? `<div class="banner">ⓘ 有 ${c.pendingN} 筆刷卡還沒出帳，暫時用外幣計算；補上帳單台幣金額後會改用台幣結算。</div>` : ''}
    ${famOn ? `<div class="card fam-switch">
      <div class="seg">${[['person', '👤 個人'], ['family', '🏠 家庭']].map(([k, l]) => `
        <label class="opt"><input type="radio" name="settleView" value="${k}" data-act="settle-view" ${view === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="small muted" style="margin-top:8px">${view === 'family'
        ? `同一家的應收應付合在一起，只算家庭之間的轉帳。${c.groups.filter((g) => !g.solo).map((g) => `🏠 ${esc(g.name)}：${g.members.map((id) => esc(memberName(id))).join('、')}`).join('　')}`
        : '每個人各自結算。'} · <a href="#" data-act="family-form">編輯家庭</a></div>
    </div>` : ''}
    <div class="card">
      <h3>🤝 轉帳建議${view === 'family' ? '（家庭之間）' : ''}</h3>
      ${(() => {
        const key = view === 'family' ? 'famTransfers' : 'transfers';
        const who = (id) => {
          if (view !== 'family') return `${avatar(member(id), 24)} ${esc(memberName(id))}`;
          const g = c.groups.find((x) => x.id === id);
          return `${groupIcon(g, 24)} ${esc(groupName(g))}`;
        };
        return c.settlements.some((s) => s[key].length) ? c.settlements.filter((s) => s[key].length).map((s) => `
        <div class="settle-cur">${flag(s.cur)} ${esc(curName(s.cur))}</div>
        ${s[key].map((t) => `
          <div class="transfer"><span class="tr-who">${who(t.from)} <span class="muted">→</span> ${who(t.to)}</span><b>${money(t.amount, t.cur)}</b></div>`).join('')}`).join('')
        : '<div class="muted">目前不需要互相轉帳 🎉</div>';
      })()}
    </div>
    ${view === 'family' ? `<div class="card">
      <h3>🏠 每一家的狀況</h3>
      ${c.groups.map((g) => {
        const ps = g.members.map((id) => c.per[id]).filter(Boolean);
        const shareTwd = ps.reduce((a, p) => a + p.shareTwd, 0);
        const share = sumCur(ps.map((p) => p.share));
        return `<div class="member-row">
          <span class="name">${groupIcon(g, 26)} ${esc(groupName(g))}</span>
          <span class="bal">${famBalanceHTML(c, g.id)}</span>
          <span class="detail">${g.solo ? '' : `成員：${g.members.map((id) => esc(memberName(id))).join('、')}<br>`}這家的花費 ${moneyMulti(share)}${shareTwd && Object.keys(share).some((k) => k !== 'TWD') ? `（≈ ${twd(shareTwd)}）` : ''}<br>實際付出 ${moneyMulti(sumCur(ps.map((p) => p.paid)))}</span>
        </div>`;
      }).join('')}
    </div>` : ''}
    <div class="card">
      <h3>👥 每個人的狀況</h3>
      ${members.map((m) => {
        const p = c.per[m.id];
        return `<div class="member-row">
          <span class="name">${avatar(m, 26)} ${esc(m.name)}${m.id === me ? '（我）' : ''}</span>
          <span class="bal">${balanceHTML(c, m.id)}</span>
          <span class="detail">自己的花費 ${moneyMulti(p.share)}${p.shareTwd && Object.keys(p.share).some((k) => k !== 'TWD') ? `（≈ ${twd(p.shareTwd)}）` : ''}<br>實際付出 ${moneyMulti(p.paid)}</span>
        </div>`;
      }).join('')}
    </div>
    ${usedCats.length ? `<div class="card">
      <h3>📊 各分類花費（約合台幣）</h3>
      <div class="tbl-wrap"><table class="tbl">
        <tr><th>分類</th>${members.map((m) => `<th>${esc(m.name)}</th>`).join('')}<th>合計</th></tr>
        ${usedCats.map((cat) => {
          const vals = members.map((m) => c.per[m.id].cats[cat.id] || 0);
          return `<tr><td>${cat.icon} ${cat.name}</td>${vals.map((v) => `<td>${fmt(Math.round(v), 0)}</td>`).join('')}<td>${fmt(Math.round(vals.reduce((a, b) => a + b, 0)), 0)}</td></tr>`;
        }).join('')}
        <tr><td>合計</td>${members.map((m) => `<td>${fmt(Math.round(c.per[m.id].shareTwd), 0)}</td>`).join('')}<td>${fmt(Math.round(c.totalTwd), 0)}</td></tr>
      </table></div>
      ${c.noRate ? `<p class="small muted">有 ${c.noRate} 筆外幣沒有匯率，未計入這張表。</p>` : ''}
    </div>` : ''}
    <p class="small muted">「自己的花費」＝ 每筆帳目分給你的部分（平分或逐項）。「實際付出」＝ 你掏錢或刷卡付掉的總額。兩者的差就是應收或應付。</p>`;
}

/* ---------- 換匯 ---------- */
export function exchangeTab(d) {
  const { trip, exchanges } = d;
  const c = calc(d, 'split');
  const cur = trip.currency;
  const me = getMe();
  const list = [...exchanges].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  // 上一趟同幣別旅程剩下的現金，可以一鍵帶入成這趟的期初現金
  const prev = previousTripSameCurrency(trip);
  let carry = '';
  if (prev) {
    const pc = calc(prev, 'split');
    const left = trip.members
      .map((m) => ({ m, cc: pc.cashCheck[m.id] }))
      .filter(({ m, cc }) => cc && cc.used && (cc.counted ?? cc.expected) > 0 && !((trip.cash || {})[m.id]?.opening));
    if (left.length) {
      carry = `<div class="banner info carry">
        <div>上一趟「${esc(prev.trip.name)}」還剩：${left.map(({ m, cc }) => `${esc(m.name)} ${fx(cc.counted ?? cc.expected, cur)}`).join('、')}</div>
        <button class="btn small" data-act="carry-cash" data-id="${esc(prev.trip.id)}">帶入成這趟的期初現金</button></div>`;
    }
  }
  const diffHTML = (cc) => {
    if (cc.counted == null) return '<span class="muted">還沒點算</span>';
    const eps = ['JPY', 'KRW', 'VND', 'IDR', 'TWD'].includes(cur) ? 0.5 : 0.005;
    if (Math.abs(cc.diff) < eps) return '<span class="pos">✅ 一致</span>';
    return cc.diff < 0
      ? `<span class="neg">少了 ${fx(-cc.diff, cur)}</span><div class="small muted">可能有現金支出還沒記</div>`
      : `<span class="neg">多了 ${fx(cc.diff, cur)}</span><div class="small muted">可能記重複，或有退款、找零沒記到</div>`;
  };
  return `
    ${carry}
    <div class="card">
      <h3>💱 每個人的匯率</h3>
      <p class="small muted" style="margin:-4px 0 6px">1 ${esc(cur)} = ? TWD。外幣現金換算台幣時，用「付款人」的匯率。</p>
      ${memberRatesHTML(trip, c)}
      <div class="kv small" style="margin-top:6px"><span class="k">全體換匯平均</span><span class="v">${c.rates.avgRate ? rateStr(c.rates.avgRate) : '—'}</span></div>
      <div class="kv small"><span class="k">刷卡預估匯率</span><span class="v">${c.rates.cardRate ? rateStr(c.rates.cardRate) : '—'}</span></div>
    </div>
    <div class="card">
      <h3>👛 ${esc(curName(cur))}現金對帳</h3>
      <p class="small muted" style="margin:-4px 0 6px">應剩 = 期初現金 ＋ 換匯／提款 − 自己用現金付的。旅程結束時點一下錢包，輸入實際剩下的金額。</p>
      ${trip.members.map((m) => {
        const cc = c.cashCheck[m.id];
        return `<div class="cash-card">
          <div class="cash-head"><span class="h-av">${avatar(m, 24)} <b>${esc(m.name)}</b>${m.id === me ? '（我）' : ''}</span>
            <button class="btn small secondary" data-act="edit-cash" data-id="${esc(m.id)}">期初／點算</button></div>
          <div class="kv"><span class="k">期初現金${cc.openingFrom ? `<small class="muted">（${esc(cc.openingFrom)}）</small>` : ''}</span><span class="v">${fx(cc.opening, cur)}</span></div>
          <div class="kv"><span class="k">＋ 換匯／提款</span><span class="v">${fx(cc.exchanged, cur)}</span></div>
          <div class="kv"><span class="k">− 現金支出</span><span class="v">${fx(cc.spent, cur)}</span></div>
          <div class="kv"><span class="k"><b>應剩</b></span><span class="v"><b>${fx(cc.expected, cur)}</b></span></div>
          <div class="kv"><span class="k">實際點算</span><span class="v">${cc.counted != null ? fx(cc.counted, cur) : '—'}</span></div>
          <div class="kv"><span class="k">差額</span><span class="v">${diffHTML(cc)}</span></div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn" data-act="add-exchange">＋ 新增換匯／提款紀錄</button>
    <div class="day" style="margin-top:20px"><span>換匯／提款紀錄</span></div>
    <div class="list">
      ${list.length ? list.map((x) => `
        <button class="item" data-act="edit-exchange" data-id="${esc(x.id)}">
          <span class="ic">${x.kind === 'atm' ? '🏧' : '💱'}<span class="ic-av">${avatar(member(x.member), 18)}</span></span>
          <span class="mid"><div class="t">${esc(memberName(x.member))} ${x.kind === 'atm' ? 'ATM 提款' : '換匯'}</div>
            <div class="s">${dayLabel(x.date)}${x.note ? ' · ' + esc(x.note) : ''}</div></span>
          <span class="amt"><div class="f">${flag(cur)} ${fx(x.foreignAmount, cur)}</div>
            <div class="tw">${x.twdAmount ? `🇹🇼 ${twd(x.twdAmount)} · ${rateStr(x.twdAmount / x.foreignAmount)}` : '<span class="tag warn">台幣金額待補</span>'}</div></span>
        </button>`).join('') : '<div class="empty">還沒有換匯紀錄。<br>記下換了多少外幣、花多少台幣，就知道每個人的匯率。</div>'}
    </div>`;
}

/* ---------- 旅程設定 ---------- */
const tripGroupsText = (trip) => tripGroups(trip).filter((g) => !g.solo).map((g) => `🏠 ${esc(g.name)}：${g.members.map((id) => esc(memberName(id))).join('、')}`).join('<br>');

export function tripSettingsTab(d) {
  const { trip } = d;
  const inTrip = new Set(trip.memberIds || []);
  return `
    <div class="card">
      <h3>旅程</h3>
      <div class="kv"><span class="k">名稱</span><span class="v">${esc(trip.name)}</span></div>
      <div class="kv"><span class="k">日期</span><span class="v">${trip.startDate ? esc(fmtRange(trip.startDate, trip.endDate)) : '未設定'}</span></div>
      <div class="kv"><span class="k">當地貨幣</span><span class="v">${flag(trip.currency)} ${esc(curName(trip.currency))} ${esc(trip.currency)}</span></div>
      <div class="kv"><span class="k">預設匯率</span><span class="v">${trip.settleRate ? rateStr(trip.settleRate) : '未設定'}</span></div>
      <div class="kv"><span class="k">刷卡預估匯率</span><span class="v">${trip.estRate ? rateStr(trip.estRate) : '未設定'}</span></div>
      <button class="btn secondary" style="margin-top:8px" data-act="edit-trip">編輯旅程</button>
    </div>
    <div class="card">
      <h3>這趟的旅伴（${inTrip.size} 人）</h3>
      <p class="small muted" style="margin-top:-4px">點一下加入或移出這趟旅程。頭像和名字在「帳本」裡統一管理。</p>
      <div class="opts">${ledgerMembers().map((m) => `
        <button class="chip av-chip ${inTrip.has(m.id) ? 'on' : ''}" data-act="toggle-trip-member" data-id="${esc(m.id)}">${avatar(m, 22)} ${esc(m.name)}</button>`).join('')}</div>
      <button class="btn secondary" style="margin-top:12px" data-act="add-member" data-to-trip="1">＋ 新增旅伴</button>
    </div>
    <div class="card">
      <h3>🏠 家庭分帳</h3>
      <p class="small muted" style="margin-top:-4px">幾家人一起出遊時用：可以按家庭平分，結算時看家庭之間怎麼轉帳。</p>
      <div class="kv"><span class="k">狀態</span><span class="v">${trip.familyMode ? '已開啟' : '關閉'}</span></div>
      ${(trip.families || []).length ? `<div class="small muted">${tripGroupsText(trip)}</div>` : ''}
      <button class="btn secondary" style="margin-top:8px" data-act="family-form">${trip.familyMode ? '編輯家庭分組' : '設定家庭分帳'}</button>
    </div>
    <div class="card">
      <h3>每個人的匯率</h3>
      ${memberRatesHTML(trip, calc(d, 'split'))}
    </div>
    <div class="card">
      <button class="btn danger" data-act="delete-trip" data-id="${esc(trip.id)}">🗑 刪除這趟旅程</button>
      <p class="small muted">刪除後會放進「帳本 → 最近刪除」保留 30 天，期間可以復原。</p>
    </div>`;
}
