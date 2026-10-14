// 計算：每筆支出算在哪個幣別、怎麼分、每個人花多少、誰該付誰
//
// 幣別規則（照實際付款方式，不強迫換算）
//   台幣支出                → 台幣
//   外幣刷卡、已補出帳金額  → 台幣（帳單金額）
//   外幣刷卡、還沒出帳      → 先算外幣，標示「待出帳」；補上帳單金額後改算台幣
//   外幣現金                → 外幣
//
// 匯率（1 當地貨幣 = ? 台幣）：每位旅伴各自一個
//   手動設定 → 自己的換匯紀錄平均（含有填台幣成本的期初現金） → 這趟的預設匯率 → 全體換匯平均 → 刷卡預估
//   換算一律用「付款人」的匯率，因為那是付款人實際換到這筆錢的成本。
//
// 結算方式（每趟旅程可選，隨時切換）
//   split 分幣別  → 外幣歸外幣、台幣歸台幣，各自結算，不換算
//   twd   全換台幣 → 外幣 × 付款人的匯率
//   local 全換外幣 → 台幣 ÷ 付款人的匯率
//
// 金額待補（amountPending）：先記下項目、之後再補金額；補上前不算進總額、結算、統計
//
// 分攤規則
//   個人   → 付款人自己的花費，不分給別人
//   平分   → 勾選的人平均分
//   逐項分 → 每個品項算給指定的人（指定多人就平分）；沒指定的品項由這趟全部旅伴平分；
//            收據總額和品項合計的差額（稅、折扣、服務費）依各人品項金額比例分攤
//   按家庭 → 勾選的家庭平均分（每家一份），家裡再由成員平均分；沒分到家庭的旅伴自己算一家
//
// 家庭分帳（每趟旅程可開關，trip.familyMode）：trip.families = [{ id, name, members: [成員id] }]
//   結算頁可以切換「個人／家庭」，家庭模式下把同一家的應收應付加總，只算家庭之間的轉帳

export const NO_DECIMAL = ['JPY', 'KRW', 'VND', 'IDR', 'TWD', 'CLP', 'ISK', 'HUF'];
export const decimals = (cur) => (NO_DECIMAL.includes(cur) ? 0 : 2);
const roundCur = (n, cur) => { const p = 10 ** decimals(cur); return Math.round(n * p) / p; };

/** 這趟的家庭分組：設定好的家庭 ＋ 沒分到家庭的旅伴（自己一組，id 是「m:成員id」） */
export function tripGroups(trip) {
  const ids = trip.members ? trip.members.map((m) => m.id) : (trip.memberIds || []);
  const used = new Set();
  const out = [];
  for (const f of trip.families || []) {
    const ms = (f.members || []).filter((id) => ids.includes(id) && !used.has(id));
    ms.forEach((id) => used.add(id));
    if (ms.length) out.push({ id: f.id, name: f.name || '未命名的家庭', members: ms, solo: false });
  }
  for (const id of ids) if (!used.has(id)) out.push({ id: 'm:' + id, name: null, members: [id], solo: true });
  return out;
}

/** 按家庭分的帳目，現在對應到哪幾組（家庭改過也跟著變；原本自己一組的人後來加入某家，就算那一家） */
export function chosenGroups(e, groups) {
  const sel = new Set(e.families || []);
  return groups.filter((g) => sel.has(g.id) || g.members.some((id) => sel.has('m:' + id)));
}

/** 回傳 { 成員id: 比例 }，比例總和為 1 */
export function shareFractions(e, memberIds, groups) {
  const valid = new Set(memberIds);
  if (e.splitMode === 'self' && valid.has(e.paidBy)) return { [e.paidBy]: 1 };
  if (e.splitMode === 'family') {
    const gs = chosenGroups(e, groups || memberIds.map((id) => ({ id: 'm:' + id, members: [id] })))
      .map((g) => g.members.filter((id) => valid.has(id))).filter((ms) => ms.length);
    if (gs.length) {
      const out = {};
      for (const ms of gs) for (const id of ms) out[id] = (out[id] || 0) + 1 / gs.length / ms.length;
      return out;
    }
  }
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

/** 這趟旅程的匯率資訊 */
export function tripRates(trip, exchanges) {
  const own = exchanges.filter((x) => !x.currency || x.currency === trip.currency);
  // 只有填了台幣成本的才能算匯率（ATM 提款還沒出帳時可能沒有）
  const priced = own.filter((x) => x.twdAmount > 0 && x.foreignAmount > 0);
  const sum = (l, k) => l.reduce((a, x) => a + (x[k] || 0), 0);
  const avgRate = priced.length ? sum(priced, 'twdAmount') / sum(priced, 'foreignAmount') : null;
  const cash = trip.cash || {};
  const manual = trip.memberRates || {};
  const fallback = trip.settleRate || avgRate || trip.estRate || null;
  const fallbackSource = trip.settleRate ? 'trip' : avgRate ? 'all' : trip.estRate ? 'est' : null;
  const autoRate = {}, memberRate = {}, memberRateSource = {};
  for (const m of trip.members || []) {
    const l = priced.filter((x) => x.member === m.id);
    let f = sum(l, 'foreignAmount'), t = sum(l, 'twdAmount');
    const op = cash[m.id];
    if (op?.opening > 0 && op?.openingTwd > 0) { f += op.opening; t += op.openingTwd; }
    autoRate[m.id] = f > 0 ? t / f : null;
    if (manual[m.id] > 0) { memberRate[m.id] = manual[m.id]; memberRateSource[m.id] = 'manual'; }
    else if (autoRate[m.id]) { memberRate[m.id] = autoRate[m.id]; memberRateSource[m.id] = 'own'; }
    else { memberRate[m.id] = fallback; memberRateSource[m.id] = fallbackSource; }
  }
  const rateOf = (id) => (id in memberRate ? memberRate[id] : fallback);
  const cardRate = trip.estRate || avgRate || trip.settleRate || null;
  return { rate: fallback, rateSource: fallbackSource, avgRate, autoRate, memberRate, memberRateSource, rateOf, cardRate };
}

/** 一筆支出：結算幣別、金額、約合台幣、約合當地貨幣 */
export function expenseValue(e, trip, rates) {
  // 金額待補：先不算進任何總額與結算
  if (e.amountPending) return { cur: e.currency, amt: 0, twd: 0, local: 0, kind: 'noamount' };
  const isLocal = e.currency === trip.currency;
  const pr = rates.rateOf(e.paidBy);
  const toLocal = (twd) => (pr ? twd / pr : null);
  if (e.currency === 'TWD') return { cur: 'TWD', amt: e.amount, twd: e.amount, local: toLocal(e.amount), kind: 'twd' };
  if (e.method === 'card' && e.billedTwd != null) {
    return { cur: 'TWD', amt: e.billedTwd, twd: e.billedTwd, local: isLocal ? e.amount : toLocal(e.billedTwd), kind: 'billed' };
  }
  if (e.method === 'card') {
    const r = isLocal ? rates.cardRate : null;
    return { cur: e.currency, amt: e.amount, twd: r ? e.amount * r : null, local: isLocal ? e.amount : null, kind: 'pending' };
  }
  return { cur: e.currency, amt: e.amount, twd: isLocal && pr ? e.amount * pr : null, local: isLocal ? e.amount : null, kind: 'cash' };
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
  const groups = tripGroups(trip);
  const per = {};
  for (const id of ids) {
    per[id] = {
      paid: {}, share: {}, paidTwd: 0, shareTwd: 0, paidLocal: 0, shareLocal: 0, shareNoRate: 0, cats: {},
      exF: 0, exT: 0, cashUsedF: 0,
    };
  }
  const byCur = {};
  let totalTwd = 0, noRate = 0, noTwd = 0, noLocal = 0;
  const rows = expenses.map((e) => ({ ...e, val: expenseValue(e, trip, rates), fractions: shareFractions(e, ids, groups) }));
  for (const r of rows) {
    if (r.amountPending) continue;
    const { cur, amt, twd, local } = r.val;
    addTo(byCur, cur, amt);
    if (twd != null) totalTwd += twd; else { noRate++; noTwd++; }
    if (local == null) noLocal++;
    if (per[r.paidBy]) {
      addTo(per[r.paidBy].paid, cur, amt);
      if (twd != null) per[r.paidBy].paidTwd += twd;
      if (local != null) per[r.paidBy].paidLocal += local;
      if (r.currency === trip.currency && r.method === 'cash') per[r.paidBy].cashUsedF += r.amount;
    }
    for (const [id, f] of Object.entries(r.fractions)) {
      if (!per[id]) continue;
      addTo(per[id].share, cur, amt * f);
      if (local != null) per[id].shareLocal += local * f;
      if (twd != null) { per[id].shareTwd += twd * f; addTo(per[id].cats, r.category || 'none', twd * f); } else per[id].shareNoRate++;
    }
  }
  for (const x of exchanges) {
    if (per[x.member] && (!x.currency || x.currency === trip.currency)) {
      per[x.member].exF += x.foreignAmount || 0;
      per[x.member].exT += x.twdAmount || 0;
    }
  }

  // 外幣現金對帳：應剩 = 期初現金 + 換匯／提款 − 自己用現金付的
  const cashCheck = {};
  for (const id of ids) {
    const c = (trip.cash || {})[id] || {};
    const opening = c.opening || 0;
    const expected = opening + per[id].exF - per[id].cashUsedF;
    const counted = c.counted ?? null;
    const used = opening || per[id].exF || per[id].cashUsedF || counted != null;
    cashCheck[id] = {
      opening, openingTwd: c.openingTwd ?? null, openingFrom: c.openingFrom || null,
      exchanged: per[id].exF, spent: per[id].cashUsedF, expected, counted,
      diff: counted != null ? counted - expected : null, used: !!used,
    };
  }

  // 結算
  const curs = Object.keys(byCur).sort((a, b) => (a === 'TWD') - (b === 'TWD'));
  let usedMode = mode;
  // 全換時每一筆都要換得過去（付款人有匯率、沒有第三種幣別），否則退回分幣別
  const convertible = mode === 'twd' ? noTwd === 0 : mode === 'local' ? noLocal === 0 : true;
  if (mode !== 'split' && !convertible) usedMode = 'split';
  const balances = {}; // cur -> [{id, v}]
  if (usedMode === 'split') {
    for (const c of curs) balances[c] = ids.map((id) => ({ id, v: (per[id].paid[c] || 0) - (per[id].share[c] || 0) }));
  } else if (usedMode === 'twd') {
    balances.TWD = ids.map((id) => ({ id, v: per[id].paidTwd - per[id].shareTwd }));
  } else {
    balances[trip.currency] = ids.map((id) => ({ id, v: per[id].paidLocal - per[id].shareLocal }));
  }
  const settlements = Object.entries(balances).map(([cur, b]) => {
    // 家庭：同一家的應收應付加總，只算家庭之間的轉帳
    const famBalances = groups.map((g) => ({ id: g.id, v: g.members.reduce((a, id) => a + (b.find((x) => x.id === id)?.v || 0), 0) }));
    return { cur, balances: b, transfers: settle(b, cur), famBalances, famTransfers: settle(famBalances, cur) };
  });

  const isPendingBill = (r) => !r.amountPending && r.currency !== 'TWD' && r.method === 'card' && r.billedTwd == null;
  const isNoAmount = (r) => !!r.amountPending;
  return {
    rows, per, rates, byCur, groups, curs, totalTwd, noRate, cashCheck,
    mode: usedMode, requestedMode: mode, convertible, settlements,
    pendingN: rows.filter(isPendingBill).length,
    isPendingBill,
    noAmountN: rows.filter(isNoAmount).length,
    isNoAmount,
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
      if (!f || r.amountPending) continue;
      addTo(tLocal, r.val.cur, r.val.amt * f);
      if (r.val.twd == null) { noRate++; continue; }
      const v = r.val.twd * f;
      tTwd += v;
      addTo(byCat, r.category || 'none', v);
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
