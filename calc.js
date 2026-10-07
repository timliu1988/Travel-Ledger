// 計算：每筆支出算在哪個幣別、怎麼分、每個人花多少、誰該付誰
//
// 幣別規則（照實際付款方式，不強迫換算）
//   台幣支出                → 台幣
//   外幣刷卡、已補出帳金額  → 台幣（帳單金額）
//   外幣刷卡、還沒出帳      → 先算外幣，標示「待出帳」；補上帳單金額後改算台幣
//   外幣現金                → 外幣
//
// 結算方式（每趟旅程可選，隨時切換）
//   split 分幣別  → 外幣歸外幣、台幣歸台幣，各自結算，不換算
//   twd   全換台幣 → 外幣 × 這趟的結算匯率
//   local 全換外幣 → 台幣 ÷ 這趟的結算匯率
//   結算匯率：手動設定 → 換匯紀錄平均 → 刷卡預估匯率
//
// 分攤規則
//   平分   → 勾選的人平均分
//   逐項分 → 每個品項算給指定的人（指定多人就平分）；沒指定的品項由這趟全部旅伴平分；
//            收據總額和品項合計的差額（稅、折扣、服務費）依各人品項金額比例分攤

export const NO_DECIMAL = ['JPY', 'KRW', 'VND', 'IDR', 'TWD', 'CLP', 'ISK', 'HUF'];
export const decimals = (cur) => (NO_DECIMAL.includes(cur) ? 0 : 2);
const roundCur = (n, cur) => { const p = 10 ** decimals(cur); return Math.round(n * p) / p; };

/** 回傳 { 成員id: 比例 }，比例總和為 1 */
export function shareFractions(e, memberIds) {
  const valid = new Set(memberIds);
  const items = (e.items || []).filter((it) => (it.amount || 0) !== 0);
  if (e.splitMode === 'items' && items.length) {
    const sums = {};
    let tot = 0;
    for (const it of items) {
      const owners = (it.owners || []).filter((o) => valid.has(o));
      const who = owners.length ? owners : memberIds;
      tot += it.amount;
      for (const o of who) sums[o] = (sums[o] || 0) + it.amount / who.length;
    }
    if (tot > 0) {
      const out = {};
      for (const [k, v] of Object.entries(sums)) out[k] = v / tot;
      return out;
    }
  }
  const parts = (e.participants || []).filter((id) => valid.has(id));
  const who = parts.length ? parts : memberIds;
  return Object.fromEntries(who.map((id) => [id, 1 / who.length]));
}

/** 這趟旅程的匯率資訊（1 當地貨幣 = ? 台幣） */
export function tripRates(trip, exchanges) {
  const own = exchanges.filter((x) => !x.currency || x.currency === trip.currency);
  const f = own.reduce((a, x) => a + (x.foreignAmount || 0), 0);
  const t = own.reduce((a, x) => a + (x.twdAmount || 0), 0);
  const avgRate = f > 0 ? t / f : null;
  const memberRate = {};
  for (const m of trip.members || []) {
    const l = own.filter((x) => x.member === m.id);
    const ff = l.reduce((a, x) => a + (x.foreignAmount || 0), 0);
    memberRate[m.id] = ff > 0 ? l.reduce((a, x) => a + (x.twdAmount || 0), 0) / ff : null;
  }
  const rate = trip.settleRate || avgRate || trip.estRate || null;
  const rateSource = trip.settleRate ? 'manual' : avgRate ? 'exchange' : trip.estRate ? 'est' : null;
  const cardRate = trip.estRate || avgRate || trip.settleRate || null;
  return { rate, rateSource, avgRate, memberRate, cardRate };
}

/** 一筆支出：結算幣別、金額、約合台幣 */
export function expenseValue(e, trip, rates) {
  if (e.currency === 'TWD') return { cur: 'TWD', amt: e.amount, twd: e.amount, kind: 'twd' };
  if (e.method === 'card' && e.billedTwd != null) return { cur: 'TWD', amt: e.billedTwd, twd: e.billedTwd, kind: 'billed' };
  const isLocal = e.currency === trip.currency;
  if (e.method === 'card') {
    const r = isLocal ? rates.cardRate : null;
    return { cur: e.currency, amt: e.amount, twd: r ? e.amount * r : null, kind: 'pending' };
  }
  const r = isLocal ? rates.rate : null;
  return { cur: e.currency, amt: e.amount, twd: r ? e.amount * r : null, kind: 'cash' };
}

/** 依金額把餘額配對成轉帳（最少次數的貪婪法） */
function settle(balances, cur) {
  const eps = decimals(cur) ? 0.005 : 0.5;
  const cred = balances.filter((b) => b.v > eps).map((b) => ({ ...b })).sort((a, b) => b.v - a.v);
  const debt = balances.filter((b) => b.v < -eps).map((b) => ({ ...b, v: -b.v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].v, cred[j].v);
    const r = roundCur(amt, cur);
    if (r > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: r, cur });
    debt[i].v -= amt; cred[j].v -= amt;
    if (debt[i].v <= eps) i++;
    if (cred[j].v <= eps) j++;
  }
  return out;
}

const addTo = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };

/**
 * 整趟旅程的計算
 * @param {{trip, expenses, exchanges}} data   trip.members 是這趟的同行旅伴
 * @param {'split'|'twd'|'local'} mode         結算方式
 */
export function calc(data, mode = 'split') {
  const { trip, expenses, exchanges } = data;
  const ids = (trip.members || []).map((m) => m.id);
  const rates = tripRates(trip, exchanges);
  const per = {};
  for (const id of ids) {
    per[id] = { paid: {}, share: {}, paidTwd: 0, shareTwd: 0, shareNoRate: 0, cats: {}, exF: 0, exT: 0, cashUsedF: 0 };
  }
  const byCur = {};
  let totalTwd = 0, noRate = 0;
  const rows = expenses.map((e) => ({ ...e, val: expenseValue(e, trip, rates), fractions: shareFractions(e, ids) }));
  for (const r of rows) {
    const { cur, amt, twd } = r.val;
    addTo(byCur, cur, amt);
    if (twd != null) totalTwd += twd; else noRate++;
    if (per[r.paidBy]) {
      addTo(per[r.paidBy].paid, cur, amt);
      if (twd != null) per[r.paidBy].paidTwd += twd;
      if (r.currency === trip.currency && r.method === 'cash') per[r.paidBy].cashUsedF += r.amount;
    }
    for (const [id, f] of Object.entries(r.fractions)) {
      if (!per[id]) continue;
      addTo(per[id].share, cur, amt * f);
      if (twd != null) { per[id].shareTwd += twd * f; addTo(per[id].cats, r.category, twd * f); } else per[id].shareNoRate++;
    }
  }
  for (const x of exchanges) {
    if (per[x.member] && (!x.currency || x.currency === trip.currency)) {
      per[x.member].exF += x.foreignAmount || 0;
      per[x.member].exT += x.twdAmount || 0;
    }
  }

  // 結算
  const curs = Object.keys(byCur).sort((a, b) => (a === 'TWD') - (b === 'TWD'));
  let usedMode = mode;
  // 全換時只能換「當地貨幣 ↔ 台幣」，還有第三種幣別或沒有匯率就退回分幣別
  const convertible = rates.rate && curs.every((c) => c === 'TWD' || c === trip.currency);
  if (mode !== 'split' && !convertible) usedMode = 'split';
  const balances = {}; // cur -> [{id, v}]
  if (usedMode === 'split') {
    for (const c of curs) balances[c] = ids.map((id) => ({ id, v: (per[id].paid[c] || 0) - (per[id].share[c] || 0) }));
  } else {
    const target = usedMode === 'twd' ? 'TWD' : trip.currency;
    const conv = (obj) => Object.entries(obj).reduce((a, [c, v]) => {
      if (c === target) return a + v;
      return a + (target === 'TWD' ? v * rates.rate : v / rates.rate);
    }, 0);
    balances[target] = ids.map((id) => ({ id, v: conv(per[id].paid) - conv(per[id].share) }));
  }
  const settlements = Object.entries(balances).map(([cur, b]) => ({ cur, balances: b, transfers: settle(b, cur) }));

  const isPendingBill = (r) => r.currency !== 'TWD' && r.method === 'card' && r.billedTwd == null;
  return {
    rows, per, rates, byCur, curs, totalTwd, noRate,
    mode: usedMode, requestedMode: mode, convertible: !!convertible, settlements,
    pendingN: rows.filter(isPendingBill).length,
    isPendingBill,
  };
}

/** 逐項分帳時，每個人在這張收據的小計（含差額比例分攤），給表單即時顯示用 */
export function itemBreakdown(items, total, memberIds) {
  const fr = shareFractions({ splitMode: 'items', items }, memberIds);
  const itemSum = (items || []).reduce((a, it) => a + (it.amount || 0), 0);
  const base = total && total > 0 ? total : itemSum;
  const unassigned = (items || []).filter((it) => (it.amount || 0) !== 0 && !(it.owners || []).length)
    .reduce((a, it) => a + it.amount, 0);
  return {
    itemSum, diff: base - itemSum, unassigned,
    per: Object.fromEntries(memberIds.map((id) => [id, (fr[id] || 0) * base])),
  };
}

/* ================= 帳本統計（跨旅程） ================= */
export function ledgerStats(tripsData, { year = 'all', memberId = 'all' } = {}) {
  const tripRows = [];
  const byYear = {}, byCountry = {}, byCat = {}, byMember = {}, itemCount = {}, storeCount = {};
  let total = 0, days = 0, noRate = 0;
  for (const d of tripsData) {
    const { trip } = d;
    const y = (trip.startDate || '').slice(0, 4) || '未設日期';
    if (year !== 'all' && y !== year) continue;
    if (memberId !== 'all' && !(trip.memberIds || []).includes(memberId)) continue;
    const c = calc(d, 'split');
    const tDays = trip.startDate ? Math.round((new Date(trip.endDate || trip.startDate) - new Date(trip.startDate)) / 86400000) + 1 : 0;
    let tTwd = 0;
    const tLocal = {};
    for (const r of c.rows) {
      const f = memberId === 'all' ? 1 : (r.fractions[memberId] || 0);
      if (!f) continue;
      addTo(tLocal, r.val.cur, r.val.amt * f);
      if (r.val.twd == null) { noRate++; continue; }
      const v = r.val.twd * f;
      tTwd += v;
      addTo(byCat, r.category || 'other', v);
      if (memberId === 'all') for (const [id, fr] of Object.entries(r.fractions)) addTo(byMember, id, r.val.twd * fr);
      if (f > 0) {
        if (r.title) addTo(storeCount, r.title, 1);
        for (const it of r.items || []) {
          const key = (it.nameZh || it.name || '').trim();
          if (key) addTo(itemCount, key, 1);
        }
      }
    }
    total += tTwd;
    days += tDays;
    addTo(byYear, y, tTwd);
    addTo(byCountry, trip.currency, tTwd);
    tripRows.push({ trip, twd: tTwd, local: tLocal, days: tDays, perDay: tDays ? tTwd / tDays : null, rate: c.rates.rate, rateSource: c.rates.rateSource });
  }
  tripRows.sort((a, b) => (b.trip.startDate || '').localeCompare(a.trip.startDate || ''));
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    trips: tripRows, total, days, noRate,
    byYear: Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])),
    byCountry: top(byCountry, 20), byCat: top(byCat, 10), byMember: top(byMember, 50),
    topItems: top(itemCount, 10), topStores: top(storeCount, 10),
  };
}
