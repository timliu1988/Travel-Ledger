// 萬年曆：點一下選開始日，再點一下選結束日
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => (s ? new Date(s + 'T00:00:00') : null);
const WEEK = '日一二三四五六';

export function fmtRange(start, end) {
  if (!start) return '';
  const a = parseYmd(start);
  const f = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  if (!end || end === start) return `${a.getFullYear()}/${f(a)}`;
  const b = parseYmd(end);
  const days = Math.round((b - a) / 86400000) + 1;
  return `${a.getFullYear()}/${f(a)} – ${a.getFullYear() !== b.getFullYear() ? b.getFullYear() + '/' : ''}${f(b)}・${days} 天`;
}

/** 回傳旅程中的每一天（YYYY-MM-DD） */
export function tripDays(start, end) {
  if (!start) return [];
  const out = [];
  const d = parseYmd(start), last = parseYmd(end || start);
  while (d <= last && out.length < 120) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

export function mountRangeCalendar(el, { start = null, end = null, onChange } = {}) {
  let s = start, e = end;
  const base = parseYmd(start) || new Date();
  let view = new Date(base.getFullYear(), base.getMonth(), 1);
  const todayStr = ymd(new Date());

  function draw() {
    const y = view.getFullYear(), m = view.getMonth();
    const first = new Date(y, m, 1).getDay();
    const daysIn = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span></span>';
    for (let d = 1; d <= daysIn; d++) {
      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
      const cls = [
        'cal-day',
        ds === s ? 'start' : '',
        ds === e ? 'end' : '',
        s && e && ds > s && ds < e ? 'mid' : '',
        ds === todayStr ? 'today' : '',
        (first + d - 1) % 7 === 0 || (first + d - 1) % 7 === 6 ? 'weekend' : '',
      ].join(' ');
      cells += `<button type="button" class="${cls}" data-d="${ds}">${d}</button>`;
    }
    el.innerHTML = `
      <div class="cal">
        <div class="cal-head">
          <button type="button" class="icon-btn" data-nav="-12" aria-label="上一年">«</button>
          <button type="button" class="icon-btn" data-nav="-1" aria-label="上個月">‹</button>
          <b>${y} 年 ${m + 1} 月</b>
          <button type="button" class="icon-btn" data-nav="1" aria-label="下個月">›</button>
          <button type="button" class="icon-btn" data-nav="12" aria-label="下一年">»</button>
        </div>
        <div class="cal-grid cal-week">${[...WEEK].map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-sum">${s ? (e ? fmtRange(s, e) : fmtRange(s) + ' → 請點結束日') : '請點選出發日'}</div>
      </div>`;
  }
  el.addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1); draw(); return; }
    const day = ev.target.closest('[data-d]');
    if (!day) return;
    const d = day.dataset.d;
    if (!s || (s && e)) { s = d; e = null; }
    else if (d < s) { s = d; }
    else { e = d; }
    draw();
    onChange?.(s, e);
  });
  draw();
  return { get: () => ({ start: s, end: e || s }) };
}
