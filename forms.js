// 各種輸入表單：旅程、帳本成員、支出、換匯
import { S, render, tripData, getMe, member, memberName, ledgerMembers, allTrips } from './state.js';
import { uid, receiptKey } from './store.js';
import { itemBreakdown, tripRates, expenseValue } from './calc.js';
import { loadImage, makeAvatar, compressReceipt } from './media.js';
import { recognizeReceipts, dictHint } from './ocr.js';
import { aiReady, aiReadReceipt } from './ai.js';
import { mountRangeCalendar, tripDays } from './calendar.js';
import {
  CATS, CURRENCIES, AVATAR_EMOJIS, flag, $, $$, esc, twd, money, rateStr, num, today, dayLabel, ls, toast, avatar,
  openSheet, closeSheet, closeAllSheets, radio, check, avLabel, openViewer,
} from './ui.js';

/** 品名是外文（日韓泰英等）才需要翻譯 */
export const needsTranslate = (it) => /[\u3040-\u30ff\uff66-\uff9f\uac00-\ud7af\u0e00-\u0e7fA-Za-z]/.test(it?.name || '');

/** 打開某趟旅程（由 app.js 提供） */
export const nav = { openTrip: () => {}, openLedger: () => {} };

/* ---------- 新增 / 編輯旅程 ---------- */
/** 這位旅伴在這趟旅程有沒有任何帳目或換匯紀錄 */
export function memberUsedInTrip(d, id) {
  return d.expenses.some((e) => e.paidBy === id || (e.splitMode !== 'items' && (e.participants || []).includes(id))
    || (e.items || []).some((it) => (it.owners || []).includes(id)))
    || d.exchanges.some((x) => x.member === id);
}

function currencyPicker(selected) {
  const main = CURRENCIES.filter((c) => c[0] !== 'TWD');
  const inGrid = main.slice(0, 12).some((c) => c[0] === selected);
  return `
    <div class="cur-grid">${main.slice(0, 12).map(([code, name, f]) => `
      <label class="opt cur-opt"><input type="radio" name="currency" value="${code}" ${selected === code ? 'checked' : ''}>
        <span><b>${f}</b>${code}<small>${name}</small></span></label>`).join('')}
    </div>
    <div class="field" style="margin-top:8px"><input name="currencyOther" list="cur-list" placeholder="其他幣別代碼，例如 CZK" value="${inGrid ? '' : esc(selected || '')}" autocapitalize="characters">
      <datalist id="cur-list">${main.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</datalist></div>`;
}

export function openTripForm(trip) {
  const isNew = !trip;
  const all = ledgerMembers();
  const t = trip || { name: '', currency: 'JPY', startDate: null, endDate: null, estRate: null, settleRate: null, memberIds: all.map((m) => m.id) };
  const memberChecks = () => ledgerMembers().map((m) => check('tm', m.id, avLabel(m), (t.memberIds || []).includes(m.id))).join('');
  const html = `
    <form id="trip-form" autocomplete="off">
      <div class="field"><label for="t-name">旅程名稱</label><input id="t-name" name="name" value="${esc(t.name)}" placeholder="例如：2026 京都賞楓" required></div>
      <div class="field"><div class="label">旅遊日期</div><div id="cal"></div></div>
      <div class="field"><div class="label">當地貨幣</div>${currencyPicker(t.currency)}</div>
      <div class="field"><div class="label">這趟同行的旅伴 <button type="button" class="link-btn" id="tm-all">全選</button></div>
        <div class="opts" id="tm-list">${memberChecks()}</div>
        <div style="display:flex;gap:8px;margin-top:10px"><input id="tm-new" placeholder="新成員的名字"><button type="button" class="btn small secondary" id="tm-add">＋ 加入</button></div>
        <div class="hint">新成員會加進帳本，頭像可以之後在「帳本 → 成員」設定。</div></div>
      <details class="field" ${isNew ? '' : 'open'}><summary class="label">匯率設定（選填）</summary>
        <div class="field" style="margin-top:8px"><label for="t-srate">預設匯率（1 外幣 = ? 台幣）</label>
          <input id="t-srate" name="settleRate" inputmode="decimal" value="${t.settleRate ?? ''}" placeholder="選填">
          <div class="hint">旅伴沒有自己的換匯紀錄、也沒手動設定匯率時用這個。每個人的匯率可以在「換匯」頁設定。</div></div>
        <div class="field"><label for="t-rate">刷卡預估匯率（1 外幣 = ? 台幣）</label>
          <input id="t-rate" name="estRate" inputmode="decimal" value="${t.estRate ?? ''}" placeholder="例如 0.215">
          <div class="hint">刷卡還沒出帳時，用來估算約合台幣。</div></div>
      </details>
      <button class="btn" type="submit">${isNew ? '建立旅程' : '儲存'}</button>
      ${isNew ? '' : `<button class="btn danger" type="button" data-act="delete-trip" data-id="${esc(trip.id)}">🗑 刪除這個旅程</button>`}
    </form>`;
  openSheet(isNew ? '新增旅程' : '編輯旅程', html, (root) => {
    const form = $('#trip-form', root);
    const cal = mountRangeCalendar($('#cal', root), { start: t.startDate, end: t.endDate });
    form.currencyOther.addEventListener('input', () => {
      if (form.currencyOther.value.trim()) $$('input[name=currency]', form).forEach((r) => { r.checked = false; });
    });
    form.addEventListener('change', (e) => { if (e.target.name === 'currency') form.currencyOther.value = ''; });
    const newMembers = [];
    $('#tm-all', root).addEventListener('click', () => {
      const boxes = $$('input[name=tm]', root);
      const allOn = boxes.every((b) => b.checked);
      boxes.forEach((b) => { b.checked = !allOn; });
    });
    $('#tm-add', root).addEventListener('click', () => {
      const inp = $('#tm-new', root);
      const name = inp.value.trim();
      if (!name) return;
      const m = { id: uid(6), name, avatar: null };
      newMembers.push(m);
      $('#tm-list', root).insertAdjacentHTML('beforeend', check('tm', m.id, avLabel(m), true));
      inp.value = '';
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = form.name.value.trim();
      const currency = (form.currencyOther.value.trim() || $('input[name=currency]:checked', form)?.value || '').toUpperCase();
      const { start, end } = cal.get();
      if (!name) { toast('請輸入旅程名稱'); return; }
      if (!/^[A-Z]{3}$/.test(currency) || currency === 'TWD') { toast('當地貨幣請選外幣（3 個英文字母）'); return; }
      const memberIds = $$('input[name=tm]:checked', root).map((x) => x.value);
      if (!memberIds.length) { toast('至少要選一位同行旅伴'); return; }
      const rateOf = (inp) => { const raw = inp.value.trim(); if (!raw) return null; const r = num(raw); return r && r > 0 ? r : NaN; };
      const estRate = rateOf(form.estRate), settleRate = rateOf(form.settleRate);
      if (Number.isNaN(estRate) || Number.isNaN(settleRate)) { toast('匯率格式不正確'); return; }
      if (newMembers.length) S.store.updateLedger(S.ledgerId, { members: [...ledgerMembers(), ...newMembers] });
      if (isNew) {
        const id = S.store.createTrip(S.ledgerId, {
          name, currency, startDate: start || null, endDate: end || null, memberIds,
          estRate, settleRate, settleMode: 'split', createdAt: Date.now(),
        });
        closeAllSheets();
        nav.openTrip(id);
        toast('旅程已建立');
      } else {
        const d = tripData(trip.id);
        const removed = (trip.memberIds || []).filter((x) => !memberIds.includes(x));
        const used = removed.filter((mid) => memberUsedInTrip(d, mid));
        if (used.length) { toast(`${used.map(memberName).join('、')} 在這趟已有帳目，不能移出`); return; }
        if (currency !== trip.currency && d.expenses.length && !confirm(`改成 ${currency}？已記的帳目會保留原本的幣別。`)) return;
        S.store.updateTrip(trip.id, { name, currency, startDate: start || null, endDate: end || null, estRate, settleRate, memberIds });
        closeSheet();
        toast('已儲存');
      }
    });
  }, { tall: true });
}

/* ---------- 旅伴：新增 / 編輯（含頭像） ---------- */
export function openMemberForm(id, { toTrip = null } = {}) {
  const m = id ? member(id) : null;
  let av = m?.avatar || null;
  let photoImg = null, crop = { zoom: 1, offsetX: 0, offsetY: 0 };
  const html = `
    <form id="mem-form" autocomplete="off">
      <div class="av-preview" id="av-prev"></div>
      <div class="field"><label for="m-name">名字</label><input id="m-name" name="name" value="${esc(m?.name || '')}" placeholder="旅伴名字" required></div>
      <div class="field"><div class="label">頭像</div>
        <div class="seg av-tabs">
          ${radio('avmode', 'letter', '文字', !av)}${radio('avmode', 'emoji', 'Emoji', av?.type === 'emoji')}${radio('avmode', 'photo', '照片', av?.type === 'photo')}
        </div></div>
      <div class="av-panel" data-panel="emoji">
        <div class="emoji-grid">${AVATAR_EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div>
        <input name="customEmoji" placeholder="或輸入任何 emoji" maxlength="8" style="margin-top:8px">
      </div>
      <div class="av-panel" data-panel="photo">
        <div class="row2"><label class="btn secondary file-btn">📷 拍照<input type="file" accept="image/*" capture="user" data-photo hidden></label>
          <label class="btn secondary file-btn">🖼️ 相簿<input type="file" accept="image/*" data-photo hidden></label></div>
        <div class="crop-ctl" hidden>
          <div class="hint">在上方圓形預覽中拖曳來調整位置</div>
          <label class="small muted">縮放 <input type="range" min="1" max="3" step="0.05" value="1" name="zoom"></label>
        </div>
      </div>
      <button class="btn" type="submit" style="margin-top:16px">${m ? '儲存' : '新增成員'}</button>
      ${m ? `<button class="btn danger" type="button" data-act="remove-member" data-id="${esc(m.id)}">從帳本移除</button>` : ''}
    </form>`;
  openSheet(m ? '編輯成員' : '新增成員', html, (root) => {
    const form = $('#mem-form', root);
    const prev = $('#av-prev', root);
    const draw = () => {
      const name = form.name.value.trim() || '?';
      prev.innerHTML = avatar({ name, avatar: av }, 96);
      const mode = form.avmode.value;
      $$('.av-panel', root).forEach((p) => { p.hidden = p.dataset.panel !== mode; });
      $$('.emoji-btn', root).forEach((b) => b.classList.toggle('on', av?.type === 'emoji' && av.value === b.dataset.emoji));
      $('.crop-ctl', root).hidden = !photoImg;
    };
    form.name.addEventListener('input', draw);
    form.addEventListener('change', (e) => {
      if (e.target.name === 'avmode') {
        const mode = e.target.value;
        if (mode === 'letter') av = null;
        else if (mode === 'emoji' && av?.type !== 'emoji') av = { type: 'emoji', value: AVATAR_EMOJIS[0] };
        else if (mode === 'photo' && av?.type !== 'photo') av = m?.avatar?.type === 'photo' ? m.avatar : av;
        draw();
      }
    });
    $$('.emoji-btn', root).forEach((b) => b.addEventListener('click', () => { av = { type: 'emoji', value: b.dataset.emoji }; draw(); }));
    form.customEmoji.addEventListener('input', () => {
      const v = form.customEmoji.value.trim();
      if (v) { av = { type: 'emoji', value: [...v].slice(0, 2).join('') }; draw(); }
    });
    const renderCrop = () => { if (photoImg) { av = { type: 'photo', value: makeAvatar(photoImg, crop) }; draw(); } };
    $$('input[data-photo]', root).forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.value = '';
      if (!f) return;
      try {
        photoImg = await loadImage(f);
        crop = { zoom: 1, offsetX: 0, offsetY: 0 };
        form.zoom.value = 1;
        renderCrop();
      } catch (err) { toast(err.message); }
    }));
    form.zoom.addEventListener('input', () => { crop.zoom = Number(form.zoom.value); renderCrop(); });
    // 拖曳調整位置
    let drag = null, raf = 0;
    prev.addEventListener('pointerdown', (e) => { if (!photoImg) return; drag = { x: e.clientX, y: e.clientY, ox: crop.offsetX, oy: crop.offsetY }; prev.setPointerCapture(e.pointerId); });
    prev.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = 1 / (60 * crop.zoom);
      crop.offsetX = Math.max(-1, Math.min(1, drag.ox - (e.clientX - drag.x) * k));
      crop.offsetY = Math.max(-1, Math.min(1, drag.oy - (e.clientY - drag.y) * k));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderCrop);
    });
    prev.addEventListener('pointerup', () => { drag = null; });
    prev.addEventListener('pointercancel', () => { drag = null; });
    draw();

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = form.name.value.trim();
      if (!name) { toast('請輸入名字'); return; }
      const newId = uid(6);
      const members = m
        ? ledgerMembers().map((x) => (x.id === m.id ? { ...x, name, avatar: av } : x))
        : [...ledgerMembers(), { id: newId, name, avatar: av }];
      S.store.updateLedger(S.ledgerId, { members });
      if (!m && toTrip) {
        const t = tripData(toTrip);
        if (t) S.store.updateTrip(toTrip, { memberIds: [...(t.trip.memberIds || []), newId] });
      }
      closeSheet();
      toast(m ? '已更新' : `已新增 ${name}`);
    });
  }, { tall: true });
}

/* ---------- 新增 / 編輯支出 ---------- */
/* ---------- 分類自動建議 ---------- */
const CAT_WORDS = [
  ['stay', /(飯店|酒店|旅館|旅店|民宿|住宿|青旅|hotel|hostel|inn\b|airbnb|ryokan|agoda|booking|ホテル|旅館|숙소|호텔)/i],
  ['transport', /(地鐵|捷運|電車|新幹線|高鐵|火車|\bjr\b|metro|subway|\bmrt\b|\bbts\b|bus|巴士|公車|客運|計程車|taxi|uber|grab|機場|airport|車票|交通|加油|停車|租車|渡輪|ferry|西瓜卡|suica|icoca|pasmo|機票|航空|airline|タクシー|電車|버스|지하철|택시)/i],
  ['fun', /(門票|入場|樂園|迪士尼|disney|usj|環球影城|博物館|美術館|museum|tour|一日遊|體驗|spa|按摩|massage|溫泉|onsen|展覽|演唱會|ticket|扭蛋|gacha|kkday|klook|水族館|動物園|纜車|觀景台)/i],
  ['shopping', /(藥妝|松本清|マツモトキヨシ|matsukiyo|sugi|大國|daikoku|唐吉|驚安|don\s*quijote|ドン|uniqlo|\bgu\b|loft|3coins|無印|muji|百貨|outlet|伴手禮|紀念品|超市|supermarket|mall|購物|bic\s*camera|yodobashi|電器|藥局|watsons|屈臣氏|boots|olive\s*young|daiso|大創|ハンズ|hands|パルコ|parco)/i],
  ['food', /(餐|飯|麵|拉麵|壽司|燒肉|咖啡|cafe|coffee|starbucks|星巴克|早餐|午餐|晚餐|宵夜|居酒屋|甜點|飲料|奶茶|啤酒|食堂|麥當勞|mcdonald|kfc|吉野家|一蘭|ramen|sushi|restaurant|bakery|麵包|便當|火鍋|烤肉|小吃|夜市|ラーメン|カフェ|식당|카페)/i],
];
export function suggestCategory(title) {
  const t = (title || '').trim();
  if (!t) return null;
  // 先看帳本裡有沒有同名的項目用過什麼分類（越近的越優先）
  const norm = (x) => (x || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const key = norm(t);
  let best = null;
  for (const d of allTrips()) {
    for (const e of d.expenses) {
      if (e.category && norm(e.title) === key && (!best || (e.createdAt || 0) > (best.createdAt || 0))) best = e;
    }
  }
  if (best) return { cat: best.category, from: 'history' };
  for (const [cat, re] of CAT_WORDS) if (re.test(t)) return { cat, from: 'keyword' };
  return null;
}

/* ---------- 貼上清單：一行一筆「品名 金額」 ---------- */
export function parseItemList(text, members, defaultOwner) {
  const out = [];
  let owner = defaultOwner;
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m.id]));
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.normalize('NFKC').trim();
    if (!line) continue;
    // 「Tim:」這種單獨一行的名字 → 之後的品項都算這個人的
    const head = line.replace(/[:：]\s*$/, '').trim().toLowerCase();
    if (byName.has(head)) { owner = byName.get(head); continue; }
    const m = line.match(/^(.*?)[\s:：,，、=\-x×*@]*[¥￥$€£₩฿\\]?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(?:円|元|원|đ|[A-Z]{3})?\s*$/i);
    if (!m) continue;
    const name = m[1].replace(/[\s:：,，、=\-x×*@]+$/, '').trim();
    const amount = parseFloat(m[2].replace(/,/g, ''));
    if (!name || !isFinite(amount) || amount === 0) continue;
    out.push({ name: name.slice(0, 60), nameZh: '', amount, owners: owner ? [owner] : [] });
  }
  return out;
}
function openPasteItems(members, defaultOwner, onDone) {
  const html = `
    <p class="small muted" style="margin-top:0">一行一筆，品名在前、金額在後，例如：</p>
    <pre class="paste-example">WAKAMOTO 7923
龍角散 1121
Curel 759
小美：
KATE唇膏 1500</pre>
    <p class="small muted">單獨一行寫旅伴的名字（例如「小美：」），下面的品項就會算給她；沒寫的算給付款人。</p>
    <textarea id="paste-text" rows="9" placeholder="把清單貼在這裡"></textarea>
    <div class="paste-preview small muted"></div>
    <button class="btn" type="button" id="paste-ok" style="margin-top:12px">帶入品項</button>`;
  openSheet('貼上品項清單', html, (root) => {
    const ta = $('#paste-text', root);
    const prev = () => {
      const list = parseItemList(ta.value, members, defaultOwner);
      $('.paste-preview', root).textContent = list.length ? `辨識出 ${list.length} 項，合計 ${list.reduce((a, x) => a + x.amount, 0).toLocaleString()}` : '';
    };
    ta.addEventListener('input', prev);
    setTimeout(() => ta.focus(), 250);
    $('#paste-ok', root).addEventListener('click', () => {
      const list = parseItemList(ta.value, members, defaultOwner);
      if (!list.length) { toast('沒有辨識到品項，請確認每行都是「品名 金額」'); return; }
      closeSheet();
      onDone(list);
      toast(`已帶入 ${list.length} 項`);
    });
  });
}

export function openExpenseForm(id) {
  const D = tripData();
  const { trip } = D;
  const e = id ? D.expenses.find((x) => x.id === id) : null;
  if (id && !e) return;
  const ids = trip.members.map((m) => m.id);
  const days = tripDays(trip.startDate, trip.endDate);
  const t = today();
  const defDate = days.includes(t) || !days.length ? t : (ls.get('tl_lastDate_' + trip.id) || days[0]);
  const v = e || {
    date: defDate, category: '', currency: trip.currency, amount: '',
    method: ls.get('tl_lastMethod', 'cash'), paidBy: ids.includes(getMe()) ? getMe() : ids[0],
    participants: ids, splitMode: 'equal', items: [], billedTwd: null, title: '', note: '',
  };
  let items = structuredClone(v.items || []);
  let receipts = []; // [{ url, img }]，長收據可以有好幾段
  let receiptsChanged = false;
  const oldCount = e ? (e.receiptCount ?? (e.hasReceipt ? 1 : 0)) : 0;
  let categoryTouched = !!e;
  const curOpts = [...new Set([trip.currency, 'TWD', v.currency])];
  const autoOcr = ls.get('tl_autoOcr', true);

  const html = `
    <form id="exp-form" autocomplete="off">
      <div class="receipt-bar">
        <div class="receipt-strip"></div>
        <div class="receipt-btns">
          <label class="btn secondary file-btn"><span class="cam-label">📷 拍收據</span><input type="file" accept="image/*" capture="environment" data-receipt hidden></label>
          <label class="btn secondary file-btn">🖼️ 相簿<input type="file" accept="image/*" multiple data-receipt hidden></label>
        </div>
        <div class="hint receipt-hint">長收據可以分段拍：每段和上一段重疊一兩行，拍完再一起辨識。</div>
        <button type="button" class="btn run-ocr-btn" data-act="run-ocr" hidden></button>
        <div class="ocr-status small" hidden></div>
        <div class="ocr-result" hidden></div>
      </div>

      <div class="field"><div class="label">幣別</div>
        <div class="seg">${curOpts.map((c) => radio('currency', c, `${flag(c)} ${c === 'TWD' ? '台幣' : c}`, v.currency === c)).join('')}</div></div>
      <div class="field"><label for="f-amount">金額</label>
        <div class="amount-input"><span class="flag-in"></span><input id="f-amount" name="amount" inputmode="decimal" value="${v.amount ?? ''}" placeholder="0"><span class="unit"></span></div></div>
      <div class="field"><label for="f-title">項目</label><input id="f-title" name="title" value="${esc(v.title)}" placeholder="例如：松本清藥妝"></div>
      <div class="field"><div class="label">分類 <span class="cat-hint small muted"></span></div>
        <div class="opts">${radio('category', '', '未分類', !v.category)}${CATS.map((c) => radio('category', c.id, `${c.icon} ${c.name}`, v.category === c.id)).join('')}</div></div>
      <div class="field"><div class="label">付款方式</div>
        <div class="seg">${radio('method', 'cash', '💵 現金', v.method === 'cash')}${radio('method', 'card', '💳 刷卡', v.method === 'card')}</div></div>
      <div class="field bill-row"><label for="f-billed">🇹🇼 台幣出帳金額（帳單出來後再補）</label>
        <input id="f-billed" name="billedTwd" inputmode="decimal" value="${v.billedTwd ?? ''}" placeholder="選填，例如 2,345">
        <div class="hint">含海外手續費的實際入帳金額。未填前用預估匯率計算。</div></div>
      <div class="field"><div class="label">誰付的</div>
        <div class="opts">${trip.members.map((m) => radio('paidBy', m.id, avLabel(m), v.paidBy === m.id)).join('')}</div></div>

      <div class="field"><div class="label">怎麼分</div>
        <div class="seg">${radio('splitMode', 'self', '🙋 個人', v.splitMode === 'self')}${radio('splitMode', 'equal', '平分', !v.splitMode || v.splitMode === 'equal')}${radio('splitMode', 'items', '🧾 逐項分', v.splitMode === 'items')}</div>
        <div class="hint split-hint"></div></div>
      <div class="split-equal">
        <div class="field"><div class="label">誰要分攤（平均分）${ids.length > 2 ? ' <button type="button" class="link-btn" id="part-all">全選</button>' : ''}</div>
          <div class="opts">${trip.members.map((m) => check('part', m.id, avLabel(m), (v.participants || ids).includes(m.id))).join('')}</div></div>
      </div>
      <div class="items-block field">
        <div class="label items-label"></div>
        <div class="hint items-hint" style="margin:-2px 0 10px">新品項預設是付款人的，點頭像改成別人；點兩個人就兩人平分。打完金額按鍵盤的「下一項」可以連續輸入。</div>
        <div class="items-list"></div>
        <div class="items-btns">
          <button type="button" class="btn small secondary" data-act="add-item">＋ 新增品項</button>
          <button type="button" class="btn small secondary" data-act="paste-items">📋 貼上清單</button>
        </div>
        <div class="quick-assign"></div>
        <div class="items-sum card"></div>
      </div>

      <div class="field"><div class="label">日期</div>
        ${days.length ? `<div class="day-chips">${days.map((d, i) => `<button type="button" class="chip day-chip" data-day="${d}"><b>D${i + 1}</b> ${dayLabel(d)}</button>`).join('')}</div>` : ''}
        <input type="date" name="date" value="${esc(v.date)}" style="margin-top:8px"></div>
      <div class="field"><label for="f-note">備註</label><input id="f-note" name="note" value="${esc(v.note)}"></div>
      <p class="small muted conv-preview"></p>
      <button class="btn" type="submit">${e ? '儲存修改' : '新增'}</button>
      ${e ? `<button class="btn danger" type="button" data-act="delete-expense" data-id="${esc(e.id)}">刪除這筆</button>` : ''}
    </form>`;

  openSheet(e ? '編輯支出' : '新增支出', html, (root) => {
    const form = $('#exp-form', root);
    const cur = () => form.currency.value;

    /* --- 品項清單 --- */
    const ownerBtns = (it, i) => trip.members.map((m) =>
      `<button type="button" class="own ${(it.owners || []).includes(m.id) ? 'on' : ''}" data-own="${i}" data-m="${esc(m.id)}" aria-label="${esc(m.name)}">${avatar(m, 30)}</button>`).join('');
    const drawItems = () => {
      $('.items-list', root).innerHTML = items.map((it, i) => `
        <div class="it-row ${(it.owners || []).length ? '' : 'unassigned'}">
          <div class="it-top">
            <input class="it-name" data-i="${i}" value="${esc(it.name || '')}" placeholder="品項" enterkeyhint="next">
            <input class="it-amt" data-i="${i}" inputmode="decimal" value="${it.amount ?? ''}" placeholder="金額" enterkeyhint="next">
            <button type="button" class="it-del" data-del="${i}" aria-label="刪除品項">✕</button>
          </div>
          <div class="it-zh-row"><span class="it-zh-ic">中</span><input class="it-zh" data-i="${i}" value="${esc(it.nameZh || '')}"
            placeholder="${needsTranslate(it) ? '連上網路後會自動翻譯' : '中文名稱（選填）'}"></div>
          <div class="it-owners">${ownerBtns(it, i)}</div>
        </div>`).join('') || '<div class="muted small" style="padding:6px 0 10px">還沒有品項。可以拍收據辨識、手動新增，或貼上一整串清單。</div>';
      drawQuick();
      drawSum();
    };
    const drawQuick = () => {
      $('.quick-assign', root).innerHTML = items.length > 1
        ? `<div class="small muted quick-row">全部改給：${trip.members.map((m) => `<button type="button" class="chip av-chip" data-assign-all="${esc(m.id)}">${avatar(m, 20)} ${esc(m.name)}</button>`).join(' ')}</div>`
        : '';
    };
    const payer = () => form.paidBy.value;
    const newItem = (name = '', amount = null, owners) => ({ name, nameZh: '', amount, owners: owners || (payer() ? [payer()] : []) });
    const addRow = () => {
      items.push(newItem());
      drawItems();
      $$('.it-name', root).at(-1)?.focus();
    };
    // 鍵盤「下一項」：品名 → 金額 → 下一行（最後一行就自動新增）
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const t = ev.target;
      if (t.classList.contains('it-name')) { ev.preventDefault(); $$('.it-amt', root)[Number(t.dataset.i)]?.focus(); }
      else if (t.classList.contains('it-amt')) {
        ev.preventDefault();
        const i = Number(t.dataset.i);
        if (i === items.length - 1) addRow(); else $$('.it-name', root)[i + 1]?.focus();
      }
    });
    const drawSum = () => {
      const total = num(form.amount.value);
      const b = itemBreakdown(items, total, ids);
      const c = cur();
      const itemsMode = form.splitMode.value === 'items';
      $('.items-sum', root).innerHTML = items.length ? `
        ${!itemsMode ? '' : trip.members.map((m) => `<div class="kv"><span class="k h-av">${avatar(m, 22)} ${esc(m.name)}</span><span class="v"><b>${money(b.per[m.id], c)}</b></span></div>`).join('')}
        <div class="kv small"><span class="k">品項合計</span><span class="v">${money(b.itemSum, c)}</span></div>
        ${total && Math.abs(b.diff) >= 0.005 ? `<div class="kv small"><span class="k">與總額差額（稅/折扣）</span><span class="v">${money(b.diff, c)}・依比例分攤</span></div>` : ''}
        ${itemsMode && b.unassigned ? `<div class="kv small"><span class="k">未指定（大家平分）</span><span class="v">${money(b.unassigned, c)}</span></div>` : ''}
        ${!total && itemsMode ? `<button type="button" class="btn small secondary" data-act="use-item-sum">用品項合計 ${money(b.itemSum, c)} 當總額</button>` : ''}` : '';
    };
    root.addEventListener('input', (ev) => {
      const i = ev.target.dataset.i;
      if (i == null) return;
      if (ev.target.classList.contains('it-name')) items[i].name = ev.target.value;
      if (ev.target.classList.contains('it-zh')) { items[i].nameZh = ev.target.value; items[i].zhSource = 'user'; }
      if (ev.target.classList.contains('it-amt')) { items[i].amount = num(ev.target.value); drawSum(); }
    });
    root.addEventListener('click', (ev) => {
      const own = ev.target.closest('[data-own]');
      if (own) {
        const it = items[own.dataset.own];
        const mid = own.dataset.m;
        it.owners = (it.owners || []).includes(mid) ? it.owners.filter((x) => x !== mid) : [...(it.owners || []), mid];
        own.classList.toggle('on');
        own.closest('.it-row').classList.toggle('unassigned', !it.owners.length);
        drawQuick();
        drawSum();
        return;
      }
      const del = ev.target.closest('[data-del]');
      if (del) { items.splice(Number(del.dataset.del), 1); drawItems(); return; }
      const all = ev.target.closest('[data-assign-all]');
      if (all) { items.forEach((it) => { it.owners = [all.dataset.assignAll]; }); drawItems(); return; }
      if (ev.target.id === 'part-all') {
        const boxes = $$('input[name=part]', form);
        const allOn = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !allOn; });
        ev.target.textContent = allOn ? '全選' : '全不選';
        return;
      }
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act === 'add-item') {
        addRow();
      } else if (act === 'paste-items') {
        openPasteItems(trip.members, payer(), (list) => {
          items = items.filter((it) => it.name || it.amount).concat(list);
          drawItems();
          sync();
        });
      } else if (act === 'use-item-sum') {
        form.amount.value = itemBreakdown(items, null, ids).itemSum;
        sync();
      } else if (act === 'run-ocr') {
        runOcr();
      }
      const view = ev.target.closest('[data-view]');
      if (view) { openViewer(receipts[Number(view.dataset.view)]?.url); return; }
      const rm = ev.target.closest('[data-rm]');
      if (rm) {
        if (!confirm('移除這張收據照片？')) return;
        receipts.splice(Number(rm.dataset.rm), 1);
        receiptsChanged = true;
        drawReceipt();
        return;
      }
      const day = ev.target.closest('[data-day]');
      if (day) { form.date.value = day.dataset.day; drawDays(); }
    });
    const drawDays = () => $$('.day-chip', root).forEach((b) => b.classList.toggle('on', b.dataset.day === form.date.value));

    /* --- 收據照片（可多段） --- */
    const engineName = () => (ls.get('tl_ocrEngine', 'auto') === 'auto' && aiReady() ? 'Gemini' : '手機辨識');
    const drawReceipt = () => {
      const n = receipts.length;
      $('.receipt-strip', root).innerHTML = receipts.map((r, i) => `
        <div class="rc">
          <button type="button" class="rc-img" data-view="${i}" aria-label="看第 ${i + 1} 段大圖"><img src="${esc(r.url)}" alt=""></button>
          ${n > 1 ? `<span class="rc-no">${i + 1}</span>` : ''}
          <button type="button" class="rc-rm" data-rm="${i}" aria-label="移除第 ${i + 1} 段">✕</button>
        </div>`).join('');
      $('.cam-label', root).textContent = n ? '📷 拍下一段' : '📷 拍收據';
      $('.receipt-hint', root).hidden = n === 0;
      const btn = $('.run-ocr-btn', root);
      btn.hidden = n === 0;
      btn.textContent = `🔍 ${n > 1 ? `辨識全部 ${n} 段` : '辨識金額與品項'}（${engineName()}）`;
      if (!n) { $('.ocr-result', root).hidden = true; $('.ocr-status', root).hidden = true; }
    };
    $$('input[data-receipt]', root).forEach((inp) => inp.addEventListener('change', async () => {
      const files = [...(inp.files || [])];
      inp.value = '';
      if (!files.length) return;
      const wasEmpty = receipts.length === 0;
      try {
        for (const f of files.slice(0, 8 - receipts.length)) {
          const img = await loadImage(f);
          receipts.push({ url: compressReceipt(img), img });
        }
        if (receipts.length >= 8) toast('一筆最多 8 張收據照片');
        receiptsChanged = true;
        drawReceipt();
        // 第一張拍完自動辨識；之後再加的段落，等使用者按「辨識全部」
        if (autoOcr && wasEmpty) runOcr();
        else if (!wasEmpty) $('.run-ocr-btn', root).classList.add('pulse');
      } catch (err) { toast(err.message); }
    }));
    if (oldCount) {
      const st = $('.ocr-status', root);
      st.hidden = false;
      st.textContent = '讀取收據照片中…';
      Promise.all([...Array(oldCount)].map((_, i) => S.store.getReceipt(S.tripId, receiptKey(e.id, i))))
        .then((urls) => {
          st.hidden = true;
          receipts = urls.filter(Boolean).map((url) => ({ url, img: null }));
          drawReceipt();
        })
        .catch(() => { st.textContent = '照片讀取失敗（可能需要網路），已存的照片不會被刪除'; });
    }
    drawReceipt();

    /* --- 辨識：有網路用 Gemini，沒有就用手機辨識 --- */
    let ocrBusy = false;
    async function runOcr() {
      if (ocrBusy || !receipts.length) return;
      ocrBusy = true;
      $('.run-ocr-btn', root).classList.remove('pulse');
      const st = $('.ocr-status', root);
      st.hidden = false;
      $('.ocr-result', root).hidden = true;
      const label = { 'loading tesseract core': '下載辨識程式', 'initializing tesseract': '準備中', 'loading language traineddata': '下載語言資料', 'initializing api': '準備中', 'recognizing text': '辨識中' };
      const setSt = (m) => {
        const p = m.progress != null ? Math.round(m.progress * 100) : null;
        const part = m.parts > 1 ? `第 ${m.part}/${m.parts} 段 ` : '';
        st.innerHTML = `<span>${part}${label[m.status] || m.status || '處理中'}${p != null ? ` ${p}%` : ''}…</span><span class="bar"><i style="width:${p ?? 10}%"></i></span>`;
      };
      let r = null, notice = '';
      try {
        if (ls.get('tl_ocrEngine', 'auto') === 'auto' && aiReady()) {
          st.innerHTML = `<span>Gemini 辨識與翻譯中${receipts.length > 1 ? `（${receipts.length} 段合併）` : ''}…</span><span class="bar indet"><i></i></span>`;
          try {
            r = await aiReadReceipt(receipts.map((x) => x.url), trip.currency);
            r.items = r.items.map((it) => ({ ...it, zhSource: 'ai' }));
          } catch (err) {
            console.warn(err);
            notice = err.message + '，改用手機辨識。';
          }
        } else if (ls.get('tl_ocrEngine', 'auto') === 'auto' && !navigator.onLine) {
          notice = '目前沒有網路，使用手機辨識；品名會在連上網路後自動翻譯。';
        }
        if (!r) {
          setSt({ status: '準備中' });
          const imgs = [];
          for (const x of receipts) imgs.push(x.img || await loadImage(x.url));
          r = await recognizeReceipts(imgs, cur() === 'TWD' ? 'TWD' : trip.currency, setSt);
          r.engine = 'local';
          r.items = r.items.map((it) => {
            const h = dictHint(it.name);
            return { ...it, nameZh: h, zhSource: h ? 'dict' : '' };
          });
        }
        st.hidden = !notice;
        st.textContent = notice;
        showOcrResult(r);
      } catch (err) {
        console.error(err);
        st.hidden = false;
        st.textContent = '辨識失敗：' + (err?.message || err) + '（照片仍會保存）';
      } finally {
        ocrBusy = false;
      }
    }
    function showOcrResult(r) {
      const box = $('.ocr-result', root);
      box.hidden = false;
      const amountWasEmpty = !num(form.amount.value);
      if (amountWasEmpty && r.currency && curOpts.includes(r.currency) && r.currency !== cur()) {
        $(`input[name=currency][value="${r.currency}"]`, form).checked = true;
      }
      const c = cur();
      const goodItems = r.items.filter((it) => it.amount);
      const hadItems = items.some((it) => it.name || it.amount);
      if (r.total && amountWasEmpty) form.amount.value = r.total;
      if (r.date && (days.length ? days.includes(r.date) : true) && !e) { form.date.value = r.date; drawDays(); }
      if (!categoryTouched && r.category) $(`input[name=category][value="${r.category}"]`, form).checked = true;
      if (!form.title.value.trim() && (r.storeZh || r.store)) form.title.value = r.storeZh || r.store;
      sync();
      const preview = goodItems.slice(0, 6).map((it) => `
        <div class="ocr-item"><span class="oi-name">${esc(it.nameZh || it.name)}${it.nameZh && it.nameZh !== it.name ? `<small>${esc(it.name)}</small>` : ''}</span><span class="num">${money(it.amount, c)}</span></div>`).join('');
      box.innerHTML = `
        <div class="ocr-head">🔍 辨識結果 <span class="tag ${r.engine === 'gemini' ? '' : 'warn'}">${r.engine === 'gemini' ? 'Gemini' : '手機辨識'}</span>
          <span class="muted small">請核對金額</span></div>
        ${r.storeZh || r.store ? `<div class="kv"><span class="k">店家</span><span class="v">${esc(r.storeZh || r.store)}${r.storeZh && r.store && r.storeZh !== r.store ? `<small class="muted">（${esc(r.store)}）</small>` : ''}</span></div>` : ''}
        <div class="kv"><span class="k">總額</span><span class="v">${r.total ? `<b>${money(r.total, c)}</b> <button type="button" class="btn small secondary" data-ocr-total>填入</button>` : '沒找到'}</span></div>
        ${r.date ? `<div class="kv"><span class="k">日期</span><span class="v">${dayLabel(r.date)}</span></div>` : ''}
        ${goodItems.length ? `<div class="ocr-items">${preview}${goodItems.length > 6 ? `<div class="muted small">…共 ${goodItems.length} 項</div>` : ''}</div>
          <div class="ocr-btns">
            ${hadItems ? `<button type="button" class="btn small secondary" data-ocr-items>用辨識結果取代品項</button>` : '<span class="small muted">品項已帶入下方明細 ✓</span>'}
            <button type="button" class="btn small" data-ocr-split>🧾 改成逐項分帳</button>
          </div>` : '<div class="kv"><span class="k">品項</span><span class="v">沒找到</span></div>'}
        ${r.engine === 'local' && goodItems.some(needsTranslate) ? '<div class="small muted" style="margin-top:6px">品名會在連上網路後自動翻譯成中文。</div>' : ''}
        <details><summary class="small muted">看辨識出的原始內容</summary><pre class="ocr-text">${esc(r.text)}</pre></details>`;
      box.querySelector('[data-ocr-total]')?.addEventListener('click', () => { form.amount.value = r.total; sync(); });
      const takeItems = () => {
        items = goodItems.map((it) => ({ name: it.name, nameZh: it.nameZh || '', zhSource: it.zhSource || '', amount: it.amount, owners: payer() ? [payer()] : [] }));
        drawItems();
        sync();
      };
      if (!hadItems && goodItems.length) takeItems();
      box.querySelector('[data-ocr-items]')?.addEventListener('click', takeItems);
      const splitBtn = box.querySelector('[data-ocr-split]');
      if (splitBtn) splitBtn.hidden = form.splitMode.value === 'items';
      splitBtn?.addEventListener('click', () => {
        $('input[name=splitMode][value=items]', form).checked = true;
        splitBtn.hidden = true;
        sync();
        drawItems();
        $('.items-block', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    /* --- 表單連動 --- */
    const sync = () => {
      const c = cur();
      const card = form.method.value === 'card';
      $('.bill-row', root).hidden = !(card && c !== 'TWD');
      $('.unit', root).textContent = c;
      $('.flag-in', root).textContent = flag(c);
      const mode = form.splitMode.value;
      const itemsMode = mode === 'items';
      $('.split-equal', root).hidden = mode !== 'equal';
      $('.split-hint', root).textContent = mode === 'self' ? `這筆是${memberName(payer())}自己的花費，不分給別人。` : '';
      // 品項明細一律可以記（之後才搜尋得到），只有逐項分時才需要指定歸屬
      const blk = $('.items-block', root);
      blk.classList.toggle('mode-items', itemsMode);
      if (itemsMode && !items.length) { items.push(newItem()); drawItems(); }
      $('.items-label', root).textContent = itemsMode ? '🧾 品項（點頭像指定是誰的）' : `品項明細（選填，記下來之後可以搜尋）${items.length ? `・${items.length} 項` : ''}`;
      $('.items-hint', root).hidden = !itemsMode;
      drawSum();
      const amt = num(form.amount.value);
      const prev = $('.conv-preview', root);
      if (!amt || c === 'TWD') { prev.textContent = ''; return; }
      const billed = num(form.billedTwd.value);
      if (card && billed != null) { prev.textContent = `實際出帳 ${twd(billed)}（匯率約 ${rateStr(billed / amt)}），結算時算台幣`; return; }
      const rates = tripRates(trip, D.exchanges);
      const r = c === trip.currency ? (card ? rates.cardRate : rates.rateOf(payer())) : null;
      prev.textContent = card
        ? `刷卡先用${c}記，帳單出來後補台幣金額${r ? `（預估約 ${twd(amt * r)}）` : ''}`
        : `現金用${c}結算${r ? `（約合 ${twd(amt * r)}，用${memberName(payer())}的匯率 ${rateStr(r)}）` : ''}`;
    };
    form.addEventListener('input', (ev) => { if (!ev.target.dataset.i) sync(); if (ev.target.name === 'date') drawDays(); });
    form.addEventListener('change', (ev) => {
      if (ev.target.name === 'category') { categoryTouched = true; $('.cat-hint', root).textContent = ''; }
      sync();
    });
    // 依項目名稱自動建議分類（使用者沒自己選過才會帶入）
    form.title.addEventListener('input', () => {
      if (categoryTouched) return;
      const sug = suggestCategory(form.title.value);
      const target = $(`input[name=category][value="${sug?.cat || ''}"]`, form);
      if (target) target.checked = true;
      $('.cat-hint', root).textContent = sug ? (sug.from === 'history' ? '（依之前的紀錄自動帶入）' : '（自動建議）') : '';
    });
    drawItems();
    drawDays();
    sync();
    if (!e && !receipts.length) setTimeout(() => form.amount.focus({ preventScroll: true }), 250);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const splitMode = form.splitMode.value;
      const cleanItems = items
        .map((it) => ({
          name: (it.name || '').trim(), nameZh: (it.nameZh || '').trim(), zhSource: it.zhSource || '',
          amount: num(it.amount), owners: (it.owners || []).filter((o) => ids.includes(o)),
        }))
        .filter((it) => it.amount);
      let amount = num(form.amount.value);
      if ((!amount || amount <= 0) && cleanItems.length) {
        amount = cleanItems.reduce((a, it) => a + it.amount, 0);
      }
      if (!amount || amount <= 0) { toast('請輸入金額'); form.amount.focus(); return; }
      const participants = $$('input[name=part]:checked', form).map((x) => x.value);
      if (splitMode === 'equal' && !participants.length) { toast('至少要勾一位分攤的人'); return; }
      if (splitMode === 'items' && !cleanItems.length) { toast('逐項分至少要有一個有金額的品項'); return; }
      const currency = cur();
      const method = form.method.value;
      const data = {
        title: form.title.value.trim(),
        category: form.category.value || null,
        currency, amount, method,
        paidBy: form.paidBy.value,
        splitMode,
        participants: splitMode === 'equal' ? participants : splitMode === 'self' ? [form.paidBy.value] : ids,
        items: cleanItems,
        billedTwd: method === 'card' && currency !== 'TWD' ? num(form.billedTwd.value) : null,
        date: form.date.value || today(),
        note: form.note.value.trim(),
        receiptCount: receiptsChanged ? receipts.length : oldCount,
        hasReceipt: (receiptsChanged ? receipts.length : oldCount) > 0,
        updatedAt: Date.now(),
      };
      data.translatePending = data.items.some((it) => needsTranslate(it) && it.zhSource !== 'ai' && it.zhSource !== 'user');
      ls.set('tl_lastMethod', method);
      ls.set('tl_lastDate_' + trip.id, data.date);
      const expId = e ? e.id : S.store.newId();
      try {
        if (receiptsChanged) {
          for (let i = 0; i < receipts.length; i++) await S.store.saveReceipt(S.tripId, receiptKey(expId, i), receipts[i].url);
          for (let i = receipts.length; i < oldCount; i++) await S.store.deleteReceipt(S.tripId, receiptKey(expId, i));
        }
      } catch (err) {
        console.error(err);
        toast('收據照片儲存失敗：' + (err?.message || err));
      }
      if (e) S.store.updateItem(S.tripId, 'expenses', e.id, data);
      else S.store.addItem(S.tripId, 'expenses', { ...data, createdAt: Date.now(), createdBy: getMe() }, expId);
      closeSheet();
      toast(e ? '已更新' : '已新增');
    });
  }, { tall: true });
}

/* ---------- 新增 / 編輯換匯 ---------- */
export function openExchangeForm(id) {
  const D = tripData();
  const { trip } = D;
  const x = id ? D.exchanges.find((y) => y.id === id) : null;
  const me = getMe();
  const v = x || { member: trip.members.some((m) => m.id === me) ? me : trip.members[0].id, kind: 'exchange', date: today(), foreignAmount: '', twdAmount: '', note: '' };
  const html = `
    <form id="ex-form" autocomplete="off">
      <div class="field"><div class="seg">${radio('kind', 'exchange', '💱 換匯', v.kind !== 'atm')}${radio('kind', 'atm', '🏧 ATM 提款', v.kind === 'atm')}</div></div>
      <div class="field"><div class="label">誰的</div>
        <div class="opts">${trip.members.map((m) => radio('member', m.id, avLabel(m), v.member === m.id)).join('')}</div></div>
      <div class="field"><label for="x-f">拿到的外幣</label>
        <div class="amount-input"><span class="flag-in">${flag(trip.currency)}</span><input id="x-f" name="foreignAmount" inputmode="decimal" value="${v.foreignAmount}" placeholder="0" required><span class="unit">${esc(trip.currency)}</span></div></div>
      <div class="field"><label for="x-t">付出的台幣 <span class="atm-note small muted"></span></label>
        <div class="amount-input"><span class="flag-in">🇹🇼</span><input id="x-t" name="twdAmount" inputmode="decimal" value="${v.twdAmount ?? ''}" placeholder="0"><span class="unit">TWD</span></div>
        <div class="hint rate-preview"></div></div>
      <div class="row2">
        <div class="field"><label for="x-d">日期</label><input id="x-d" type="date" name="date" value="${esc(v.date)}"></div>
        <div class="field"><label for="x-n">備註</label><input id="x-n" name="note" value="${esc(v.note)}" placeholder="例如：台銀機場"></div>
      </div>
      <button class="btn" type="submit">${x ? '儲存修改' : '新增'}</button>
      ${x ? `<button class="btn danger" type="button" data-act="delete-exchange" data-id="${esc(x.id)}">刪除這筆</button>` : ''}
    </form>`;
  openSheet(x ? '編輯換匯／提款' : '新增換匯／提款', html, (root) => {
    const form = $('#ex-form', root);
    const sync = () => {
      const f = num(form.foreignAmount.value), t = num(form.twdAmount.value);
      $('.atm-note', root).textContent = form.kind.value === 'atm' ? '（選填，信用卡帳單出來再補）' : '';
      $('.rate-preview', root).textContent = f && t ? `匯率：1 ${trip.currency} = ${rateStr(t / f)} TWD（1 TWD = ${rateStr(f / t)} ${trip.currency}）` : '';
    };
    form.addEventListener('input', sync);
    sync();
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = num(form.foreignAmount.value), t = num(form.twdAmount.value);
      const kind = form.kind.value;
      if (!f || f <= 0) { toast('請輸入外幣金額'); return; }
      if (kind === 'exchange' && (!t || t <= 0)) { toast('請輸入付出的台幣'); return; }
      const data = { member: form.member.value, kind, currency: trip.currency, foreignAmount: f, twdAmount: t && t > 0 ? t : null, date: form.date.value || today(), note: form.note.value.trim(), updatedAt: Date.now() };
      if (x) S.store.updateItem(S.tripId, 'exchanges', x.id, data);
      else S.store.addItem(S.tripId, 'exchanges', { ...data, createdAt: Date.now() });
      closeSheet();
      toast(x ? '已更新' : '已新增');
    });
  });
}

/* ---------- 建立帳本 ---------- */
export function openLedgerForm() {
  const html = `
    <form id="ledger-form" autocomplete="off">
      <div class="field"><label for="l-name">帳本名稱</label><input id="l-name" name="lname" placeholder="例如：Tim & 另一半、大學同學出遊" required></div>
      <div class="field"><label for="l-me">你的名字</label><input id="l-me" name="me" placeholder="例如：Tim" required></div>
      <div class="field"><div class="label">其他成員（人數不限，之後也可以再加）</div>
        <div id="mates"><input name="mate" placeholder="成員名字" style="margin-bottom:8px"></div>
        <button type="button" class="btn small secondary" id="add-mate">＋ 再加一位</button>
        <div class="hint">頭像可以之後在「帳本 → 成員」設定。每趟旅程再勾選誰有同行。</div></div>
      <button class="btn" type="submit">建立帳本</button>
    </form>`;
  openSheet('建立帳本', html, (root) => {
    const form = $('#ledger-form', root);
    $('#add-mate', root).addEventListener('click', () => {
      const i = document.createElement('input');
      i.name = 'mate'; i.placeholder = '成員名字'; i.style.marginBottom = '8px';
      $('#mates', root).appendChild(i); i.focus();
    });
    setTimeout(() => form.lname.focus(), 250);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = form.lname.value.trim(), meName = form.me.value.trim();
      if (!name || !meName) { toast('請輸入帳本名稱和你的名字'); return; }
      const meId = uid(6);
      const members = [{ id: meId, name: meName, avatar: null }];
      $$('input[name=mate]', root).forEach((i) => { if (i.value.trim()) members.push({ id: uid(6), name: i.value.trim(), avatar: null }); });
      const id = S.store.createLedger({ name, members, createdAt: Date.now() });
      ls.set('tl_me_' + id, meId);
      closeAllSheets();
      nav.openLedger(id, name);
      toast('帳本已建立');
    });
  });
}

/* ---------- 加入帳本 ---------- */
export function openJoin(prefill = '') {
  const html = `
    <form id="join-form" autocomplete="off">
      <div class="field"><label for="j-code">帳本代碼</label>
        <input id="j-code" name="code" value="${esc(prefill)}" placeholder="旅伴分享給你的代碼或連結" autocapitalize="none" autocorrect="off" required></div>
      <p class="small muted">換新手機時，也是在這裡輸入原本的帳本代碼。</p>
      <button class="btn" type="submit">加入</button>
    </form>`;
  openSheet('加入帳本', html, (root) => {
    const form = $('#join-form', root);
    setTimeout(() => form.code.focus(), 250);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      let code = form.code.value.trim();
      const m = code.match(/[?&]join=([a-z0-9]+)/i);
      if (m) code = m[1];
      code = code.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!code) return;
      try {
        if (!(await S.store.ledgerExists(code))) {
          toast(S.store.mode === 'local' ? '找不到：本機模式只能開這支手機建立的帳本' : '找不到這個帳本代碼');
          return;
        }
      } catch (err) {
        console.error(err);
        toast('連線失敗，請確認網路後再試');
        return;
      }
      closeAllSheets();
      nav.openLedger(code);
    });
  });
}

/* ---------- 「我是誰」 ---------- */
export function openWhoAmI() {
  const html = `
    <p class="muted" style="margin-top:0">這支手機的使用者是誰？新增支出時會預設由你付款。</p>
    <div class="opts" style="margin-bottom:16px">${ledgerMembers().map((m) => `<button class="chip av-chip" data-act="set-me" data-id="${esc(m.id)}" data-close="1">${avatar(m, 26)} ${esc(m.name)}</button>`).join('')}</div>
    <div style="display:flex;gap:8px"><input id="me-new" placeholder="都不是？輸入你的名字"><button class="btn small" data-act="add-me">加入</button></div>`;
  openSheet('你是哪一位？', html);
}


/* ---------- 帳本改名 ---------- */
export function openRenameLedger() {
  const cur = S.ld.ledger.name;
  openSheet('編輯帳本名稱', `
    <form id="rn-form" autocomplete="off">
      <div class="field"><label for="rn">帳本名稱</label><input id="rn" name="rn" value="${esc(cur)}" required></div>
      <button class="btn" type="submit">儲存</button>
    </form>`, (root) => {
    const form = $('#rn-form', root);
    setTimeout(() => { form.rn.focus(); form.rn.select(); }, 250);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = form.rn.value.trim();
      if (!v) { toast('請輸入名稱'); return; }
      S.store.updateLedger(S.ledgerId, { name: v });
      closeSheet();
      toast('已改名');
    });
  });
}

/* ---------- 某位旅伴在這趟的匯率 ---------- */
export function openRateForm(mid) {
  const D = tripData();
  const { trip } = D;
  const rates = tripRates(trip, D.exchanges);
  const manual = (trip.memberRates || {})[mid];
  const auto = rates.autoRate[mid];
  openSheet(`${memberName(mid)} 的匯率`, `
    <form id="rate-form" autocomplete="off">
      <p class="small muted" style="margin-top:0">1 ${esc(trip.currency)} = ? TWD。${memberName(mid)}付的外幣現金，換算台幣時用這個匯率。</p>
      <div class="kv"><span class="k">依換匯紀錄自動計算</span><span class="v">${auto ? rateStr(auto) : '沒有紀錄'}</span></div>
      <div class="field" style="margin-top:10px"><label for="mr">手動設定（選填，會優先使用）</label>
        <input id="mr" name="mr" inputmode="decimal" value="${manual ?? ''}" placeholder="${auto ? rateStr(auto) : '例如 0.215'}"></div>
      <button class="btn" type="submit">儲存</button>
      ${manual ? '<button class="btn secondary" type="button" id="mr-clear">清除手動設定，改用自動計算</button>' : ''}
    </form>`, (root) => {
    const form = $('#rate-form', root);
    $('#mr-clear', root)?.addEventListener('click', () => {
      S.store.updateTrip(trip.id, { [`memberRates.${mid}`]: null });
      closeSheet();
      toast('已改用自動計算');
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = form.mr.value.trim();
      const r = raw ? num(raw) : null;
      if (raw && (!r || r <= 0)) { toast('匯率格式不正確'); return; }
      S.store.updateTrip(trip.id, { [`memberRates.${mid}`]: r });
      closeSheet();
      toast('已儲存');
    });
  });
}

/* ---------- 外幣現金：期初、實際點算 ---------- */
export function openCashForm(mid) {
  const D = tripData();
  const { trip } = D;
  const c = (trip.cash || {})[mid] || {};
  const cur = trip.currency;
  openSheet(`${memberName(mid)} 的${cur}現金`, `
    <form id="cash-form" autocomplete="off">
      <div class="field"><label for="co">期初現金（出發時錢包裡已經有的${esc(cur)}）</label>
        <div class="amount-input"><span class="flag-in">${flag(cur)}</span><input id="co" name="opening" inputmode="decimal" value="${c.opening ?? ''}" placeholder="0"><span class="unit">${esc(cur)}</span></div>
        <div class="hint">例如上次旅行剩下的。這趟出發前「新換」的請記在換匯紀錄，不要重複填在這裡。</div></div>
      <div class="field"><label for="cot">這筆期初現金當初的台幣成本（選填）</label>
        <input id="cot" name="openingTwd" inputmode="decimal" value="${c.openingTwd ?? ''}" placeholder="知道的話填，會一起算進匯率"></div>
      <div class="field"><label for="cc">實際點算（旅程結束時錢包裡剩下的${esc(cur)}）</label>
        <div class="amount-input"><span class="flag-in">${flag(cur)}</span><input id="cc" name="counted" inputmode="decimal" value="${c.counted ?? ''}" placeholder="還沒點算就留空"><span class="unit">${esc(cur)}</span></div></div>
      <button class="btn" type="submit">儲存</button>
    </form>`, (root) => {
    const form = $('#cash-form', root);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const val = (inp) => { const raw = inp.value.trim(); if (!raw) return null; const n = num(raw); return n != null && n >= 0 ? n : NaN; };
      const opening = val(form.opening), openingTwd = val(form.openingTwd), counted = val(form.counted);
      if ([opening, openingTwd, counted].some((x) => Number.isNaN(x))) { toast('金額格式不正確'); return; }
      S.store.updateTrip(trip.id, {
        [`cash.${mid}`]: { ...c, opening, openingTwd, counted, countedAt: counted != null ? Date.now() : null },
      });
      closeSheet();
      toast('已儲存');
    });
  });
}
