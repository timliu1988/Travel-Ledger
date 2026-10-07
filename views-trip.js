// 單一旅程的四個頁籤：帳目、結算、換匯、設定
import { S, getMe, member, memberName, ledgerMembers } from './state.js';
import { calc, decimals } from './calc.js';
import { fmtRange, tripDays } from './calendar.js';
import {
  CATS, catOf, flag, curName, esc, fmt, twd, fx, money, moneyMulti, moneyLines, rateStr, dayLabel, avatar,
} from './ui.js';

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
export function listTab(d) {
  const { trip } = d;
  const c = calc(d, trip.settleMode || 'split');
  let rows = c.rows;
  if (S.filter === 'pending') rows = rows.filter(c.isPendingBill);
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
    if (r.splitMode === 'items') split = '逐項分';
    else if (ids.length === trip.members.length && ids.length > 1) split = '大家分';
    else if (ids.length === 1) split = `${esc(memberName(ids[0]))}自己`;
    else split = `${ids.length} 人分`;
    let sub = '';
    if (r.val.kind === 'billed') sub = `${twd(r.billedTwd)} <span class="tag">已出帳</span>`;
    else if (r.val.kind === 'pending') sub = `${r.val.twd != null ? '≈ ' + twd(r.val.twd) + ' ' : ''}<span class="tag warn">待出帳</span>`;
    else if (r.val.kind === 'cash' && r.val.twd != null) sub = `≈ ${twd(r.val.twd)}`;
    const names = (r.items || []).map((it) => it.nameZh || it.name).filter(Boolean);
    let html = `
      <button class="item" data-act="edit-expense" data-id="${esc(r.id)}">
        <span class="ic">${cat.icon}<span class="ic-av">${avatar(member(r.paidBy), 18)}</span></span>
        <span class="mid"><div class="t">${esc(r.title || cat.name)}</div>
          <div class="s">${r.method === 'card' ? '💳' : '💵'} ${esc(memberName(r.paidBy))}付 · ${split}${r.hasReceipt ? ` · 🧾${(r.receiptCount || 1) > 1 ? '×' + r.receiptCount : ''}` : ''}</div>
          ${names.length ? `<div class="s s2">${esc(names.slice(0, 4).join('、'))}${names.length > 4 ? `…等 ${names.length} 項` : ''}${r.translatePending ? ' <span class="tag warn">待翻譯</span>' : ''}</div>` : ''}</span>
        <span class="amt"><div class="f"><span class="fl">${flag(r.currency)}</span>${money(r.amount, r.currency)}</div><div class="tw">${sub}</div></span>
      </button>`;
    if (S.filter === 'pending') {
      html += `<div class="bill"><input inputmode="decimal" placeholder="帳單台幣金額" data-bill="${esc(r.id)}" aria-label="台幣出帳金額">
        <button class="btn small" data-act="save-bill" data-id="${esc(r.id)}">儲存</button></div>`;
    }
    return html;
  };

  return `
    ${peopleSummary(d, c)}
    ${c.pendingN && S.filter !== 'pending' ? `<button class="banner" data-act="filter" data-filter="pending">💳 有 ${c.pendingN} 筆刷卡還沒補台幣出帳金額 ›</button>` : ''}
    <div class="chips">
      <button class="chip ${S.filter === 'all' ? 'on' : ''}" data-act="filter" data-filter="all">全部</button>
      <button class="chip ${S.filter === 'pending' ? 'on' : ''}" data-act="filter" data-filter="pending">待補出帳 ${c.pendingN ? `(${c.pendingN})` : ''}</button>
    </div>
    ${groups.length ? groups.map((g) => {
      const dayCur = {};
      g.items.forEach((r) => { dayCur[r.val.cur] = (dayCur[r.val.cur] || 0) + r.val.amt; });
      const di = days.indexOf(g.date);
      return `<div class="day"><span>${dayLabel(g.date)}${di >= 0 ? ` · Day ${di + 1}` : ''}</span><span class="num">${moneyMulti(dayCur, false)}</span></div>
        <div class="list">${g.items.map(itemHTML).join('')}</div>`;
    }).join('') : `<div class="list"><div class="empty">${S.filter === 'pending' ? '刷卡帳目都已補上台幣金額 👍' : '還沒有帳目，按右下角 ＋ 新增第一筆'}</div></div>`}`;
}

/* ---------- 結算 ---------- */
export function settleTab(d) {
  const { trip } = d;
  const c = calc(d, trip.settleMode || 'split');
  const members = trip.members;
  const me = getMe();
  const lbl = SETTLE_LABEL(trip.currency);
  const usedCats = CATS.filter((cat) => members.some((m) => c.per[m.id].cats[cat.id]));
  const srcLabel = { manual: '手動設定', exchange: '換匯紀錄平均', est: '刷卡預估匯率' }[c.rates.rateSource] || '';
  return `
    <div class="card">
      <h3>結算方式</h3>
      <div class="seg">${['split', 'twd', 'local'].map((k) => `
        <label class="opt"><input type="radio" name="settleMode" value="${k}" data-act="settle-mode" ${(trip.settleMode || 'split') === k ? 'checked' : ''}><span>${lbl[k]}</span></label>`).join('')}</div>
      <p class="small muted" style="margin:8px 0 0">${{
        split: '外幣現金用外幣結、刷卡出帳和台幣支出用台幣結，不做換算。',
        twd: '外幣金額用下面的結算匯率換成台幣，最後只結一筆台幣。',
        local: `台幣金額用下面的結算匯率換成${curName(trip.currency)}，最後只結一筆${curName(trip.currency)}。`,
      }[trip.settleMode || 'split']}</p>
      <div class="kv" style="margin-top:6px"><span class="k">結算匯率</span>
        <span class="v">${c.rates.rate ? `1 ${esc(trip.currency)} = ${rateStr(c.rates.rate)} TWD（${srcLabel}）` : '尚未設定'}
        <button class="btn small secondary" data-act="edit-trip">設定</button></span></div>
      ${c.mode !== c.requestedMode ? `<div class="banner" style="margin:8px 0 0">${c.rates.rate ? '這趟有第三種幣別的支出，無法全部換算，暫時用分幣別結算。' : '還沒有結算匯率：請新增換匯紀錄，或在「設定」填結算匯率。'}</div>` : ''}
    </div>
    ${c.pendingN ? `<div class="banner">ⓘ 有 ${c.pendingN} 筆刷卡還沒出帳，暫時用外幣計算；補上帳單台幣金額後會改用台幣結算。</div>` : ''}
    <div class="card">
      <h3>🤝 轉帳建議</h3>
      ${c.settlements.some((s) => s.transfers.length) ? c.settlements.filter((s) => s.transfers.length).map((s) => `
        <div class="settle-cur">${flag(s.cur)} ${esc(curName(s.cur))}</div>
        ${s.transfers.map((t) => `
          <div class="transfer"><span class="tr-who">${avatar(member(t.from), 24)} ${esc(memberName(t.from))} <span class="muted">→</span> ${avatar(member(t.to), 24)} ${esc(memberName(t.to))}</span><b>${money(t.amount, t.cur)}</b></div>`).join('')}`).join('')
        : '<div class="muted">目前不需要互相轉帳 🎉</div>'}
    </div>
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
  return `
    <div class="card">
      <h3>💱 這趟的匯率</h3>
      <div class="kv"><span class="k">換匯平均</span><span class="v">${c.rates.avgRate ? `1 ${esc(cur)} = ${rateStr(c.rates.avgRate)} TWD` : '尚無紀錄'}</span></div>
      <div class="kv"><span class="k">結算匯率</span><span class="v">${c.rates.rate ? rateStr(c.rates.rate) : '—'}${trip.settleRate ? '（手動）' : ''}</span></div>
      <div class="kv"><span class="k">刷卡預估</span><span class="v">${c.rates.cardRate ? rateStr(c.rates.cardRate) : '—'}</span></div>
      <p class="small muted" style="margin:6px 0 0">換匯紀錄只是記錄，不一定要換算。要換算時，在「結算」選全換台幣或全換${esc(curName(cur))}。</p>
    </div>
    ${trip.members.map((m) => {
      const p = c.per[m.id];
      if (!p.exF && !p.cashUsedF) return '';
      return `<div class="card">
        <h3 class="h-av">${avatar(m, 24)} ${esc(m.name)}${m.id === me ? '（我）' : ''} 的${esc(curName(cur))}現金</h3>
        <div class="kv"><span class="k">換匯總額</span><span class="v">${flag(cur)} ${fx(p.exF, cur)}（${twd(p.exT)}）</span></div>
        <div class="kv"><span class="k">平均匯率</span><span class="v">${p.exF ? rateStr(c.rates.memberRate[m.id]) : '—'}</span></div>
        <div class="kv"><span class="k">現金已花（自己付的）</span><span class="v">${fx(p.cashUsedF, cur)}</span></div>
        <div class="kv"><span class="k">剩餘現金（推算）</span><span class="v"><b>${fx(p.exF - p.cashUsedF, cur)}</b></span></div>
      </div>`;
    }).join('')}
    <button class="btn" data-act="add-exchange">＋ 新增換匯紀錄</button>
    <div class="day" style="margin-top:20px"><span>換匯紀錄</span></div>
    <div class="list">
      ${list.length ? list.map((x) => `
        <button class="item" data-act="edit-exchange" data-id="${esc(x.id)}">
          <span class="ic">💱<span class="ic-av">${avatar(member(x.member), 18)}</span></span>
          <span class="mid"><div class="t">${esc(memberName(x.member))} 換匯</div>
            <div class="s">${dayLabel(x.date)}${x.note ? ' · ' + esc(x.note) : ''}</div></span>
          <span class="amt"><div class="f">${flag(cur)} ${fx(x.foreignAmount, cur)}</div>
            <div class="tw">🇹🇼 ${twd(x.twdAmount)} · ${rateStr(x.twdAmount / x.foreignAmount)}</div></span>
        </button>`).join('') : '<div class="empty">還沒有換匯紀錄。<br>記下換了多少外幣、花多少台幣，就知道這趟的匯率。</div>'}
    </div>`;
}

/* ---------- 旅程設定 ---------- */
export function tripSettingsTab(d) {
  const { trip } = d;
  const inTrip = new Set(trip.memberIds || []);
  return `
    <div class="card">
      <h3>旅程</h3>
      <div class="kv"><span class="k">名稱</span><span class="v">${esc(trip.name)}</span></div>
      <div class="kv"><span class="k">日期</span><span class="v">${trip.startDate ? esc(fmtRange(trip.startDate, trip.endDate)) : '未設定'}</span></div>
      <div class="kv"><span class="k">當地貨幣</span><span class="v">${flag(trip.currency)} ${esc(curName(trip.currency))} ${esc(trip.currency)}</span></div>
      <div class="kv"><span class="k">結算匯率</span><span class="v">${trip.settleRate ? rateStr(trip.settleRate) : '未設定（用換匯平均）'}</span></div>
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
      <button class="btn danger" data-act="delete-trip" data-id="${esc(trip.id)}">🗑 刪除這趟旅程</button>
      <p class="small muted">會刪除這趟所有帳目、換匯紀錄、收據照片，帳本裡的所有人都看不到，無法復原。</p>
    </div>`;
}
