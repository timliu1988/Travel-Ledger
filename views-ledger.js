// 帳本層級的畫面：歡迎頁、旅程列表、搜尋、統計、帳本設定
import { S, getMe, member, memberName, ledgerMembers, myLedgers, allTrips, deletedTrips, daysLeft } from './state.js';
import { calc, ledgerStats } from './calc.js';
import { searchAll } from './search.js';
import { appBuild } from './update.js';
import { THEMES, MODES, getTheme, getMode } from './theme.js';
import { fmtRange, ymd } from './calendar.js';
import {
  CATS, catOf, flag, countryName, esc, fmt, twd, money, moneyMulti, rateStr, dayLabel, avatar, ls,
} from './ui.js';

/* ---------- 第一次使用 ---------- */
export function welcomeHTML() {
  return `
    <main>
      <div class="hero"><img src="icons/icon-192.png" alt=""><h2>旅伴記帳</h2>
        <p class="muted small">外幣・台幣・刷卡出帳・收據拍照<br>和旅伴一起把每一趟旅程的帳記清楚</p></div>
      <div class="card">
        <h3>先建立一本帳本</h3>
        <p class="small muted" style="margin-top:-4px">帳本是「一群固定一起出遊的人」，例如「我和另一半」「大學同學」。
          每一趟旅程都記在帳本裡，加入一次就能看到過去和未來所有旅程。</p>
        <button class="btn" data-act="new-ledger">＋ 建立帳本</button>
        <button class="btn secondary" data-act="join-ledger">輸入代碼，加入旅伴的帳本</button>
        <button class="btn secondary" data-act="import-backup">從備份檔還原</button>
      </div>
      ${myLedgers().filter((l) => l.deletedAt).length ? `<div class="card"><h3>🗑 最近刪除的帳本</h3>
        ${myLedgers().filter((l) => l.deletedAt).map((l) => `<button class="member-line" data-act="switch-ledger" data-id="${esc(l.id)}"><span class="trip-flag">📒</span><span class="mid">${esc(l.name)} <span class="tag warn">剩 ${daysLeft(l.deletedAt)} 天</span></span><span class="muted">›</span></button>`).join('')}</div>` : ''}
      <p class="small muted center">${S.store?.mode === 'firebase' ? '☁️ 雲端同步已啟用' : '📱 本機模式：資料只存在這支手機，尚未設定雲端同步'}</p>
    </main>`;
}

/* ---------- 旅程列表 ---------- */
export function tripsTab() {
  // 有日期的依出發日由新到舊，沒設定日期的排在最後（依建立順序）
  const trips = allTrips().sort((a, b) => (b.trip.startDate || '').localeCompare(a.trip.startDate || '') || (a.trip.createdAt || 0) - (b.trip.createdAt || 0));
  const now = ymd(new Date());
  const status = (t) => {
    if (!t.startDate) return '';
    if (now < t.startDate) return '<span class="tag">即將出發</span>';
    if (now <= (t.endDate || t.startDate)) return '<span class="tag go">旅行中</span>';
    return '';
  };
  let lastYear = null;
  const cards = trips.map((d) => {
    const { trip } = d;
    const y = (trip.startDate || '').slice(0, 4) || '未設定日期';
    const head = y !== lastYear ? `<div class="year-head">${esc(y)}</div>` : '';
    lastYear = y;
    const c = calc(d, 'split');
    const ms = trip.members;
    return `${head}
      <div class="card trip-card2">
        <button class="trip-open2" data-act="open-trip" data-id="${esc(trip.id)}">
          <span class="trip-flag">${flag(trip.currency)}</span>
          <span class="mid">
            <div class="t">${esc(trip.name)} ${status(trip)}</div>
            <div class="small muted">${trip.startDate ? esc(fmtRange(trip.startDate, trip.endDate)) : '未設定日期'}</div>
            <div class="small trip-sum">${d.expenses.length ? `${moneyMulti(c.byCur, false)}${c.curs.some((k) => k !== 'TWD') && c.totalTwd ? ` <span class="muted">≈ ${twd(c.totalTwd)}</span>` : ''}${c.noAmountN ? ` <span class="tag warn">${c.noAmountN} 筆金額待補</span>` : ''}` : '<span class="muted">還沒有帳目</span>'}</div>
            <div class="av-stack">${ms.slice(0, 7).map((m) => avatar(m, 22)).join('')}${ms.length > 7 ? `<span class="av-more">+${ms.length - 7}</span>` : ''}</div>
          </span>
        </button>
        <button class="icon-btn more" data-act="trip-menu" data-id="${esc(trip.id)}" aria-label="更多">⋯</button>
      </div>`;
  }).join('');
  return `
    ${S.ld.pending ? '<p class="small muted center">同步中…</p>' : ''}
    ${cards || `<div class="card empty">這本帳本還沒有旅程。<br>按下面的按鈕新增第一趟吧！</div>`}
    <button class="btn" style="margin-top:12px" data-act="new-trip">＋ 新增旅程</button>
    ${deletedTrips().length ? `<button class="btn secondary" data-act="open-trash">🗑 最近刪除（${deletedTrips().length}）</button>` : ''}`;
}

/* ---------- 搜尋 ---------- */
export function searchTab() {
  return `
    <div class="search-box">
      <input type="search" id="q" value="${esc(S.searchQ)}" placeholder="搜尋品項、店家（中文或原文都可以）" autocomplete="off" enterkeyhint="search">
    </div>
    <div id="search-results">${searchResultsHTML()}</div>`;
}

export function searchResultsHTML() {
  const trips = allTrips();
  if (!S.searchQ.trim()) {
    const st = ledgerStats(trips);
    return `
      <p class="small muted">例如輸入「克潰精」或「キャベジン」，會列出每一趟買過的紀錄和價格。可以用空白分開多個關鍵字，例如「松本清 面膜」。</p>
      ${st.topItems.length ? `<div class="small muted" style="margin:14px 0 6px">最常買的品項</div>
        <div class="opts">${st.topItems.map(([k, n]) => `<button class="chip" data-act="quick-search" data-q="${esc(k)}">${esc(k)} <span class="muted">×${n}</span></button>`).join('')}</div>` : ''}
      ${st.topStores.length ? `<div class="small muted" style="margin:14px 0 6px">常去的店</div>
        <div class="opts">${st.topStores.map(([k, n]) => `<button class="chip" data-act="quick-search" data-q="${esc(k)}">${esc(k)} <span class="muted">×${n}</span></button>`).join('')}</div>` : ''}`;
  }
  const { results, summary, total } = searchAll(trips, S.searchQ);
  if (!results.length) return '<div class="empty">找不到符合的紀錄</div>';
  const when = (x) => `${(x.expense.date || '').slice(0, 7).replace('-', '/')} ${esc(x.trip.name)}`;
  return `
    ${summary ? `<div class="card price-sum">
      <div class="small muted">價格比較（${summary.count} 筆 ${flag(summary.cur)} ${esc(summary.cur)}）</div>
      <div class="kv"><span class="k">最低</span><span class="v"><b>${money(summary.min.amount, summary.cur)}</b> <span class="small muted">${when(summary.min)}</span></span></div>
      <div class="kv"><span class="k">最高</span><span class="v"><b>${money(summary.max.amount, summary.cur)}</b> <span class="small muted">${when(summary.max)}</span></span></div>
    </div>` : ''}
    <div class="small muted" style="margin:4px 2px 8px">找到 ${total} 筆${total > results.length ? `（顯示前 ${results.length} 筆）` : ''}</div>
    <div class="list">${results.map((x) => {
      const e = x.expense;
      const cat = catOf(e.category);
      const title = x.type === 'item' ? (x.item.nameZh || x.item.name) : (e.title || cat.name);
      const orig = x.type === 'item' && x.item.nameZh && x.item.nameZh !== x.item.name ? x.item.name : '';
      const owners = x.type === 'item' && (x.item.owners || []).length ? ` · ${x.item.owners.map(memberName).map(esc).join('、')}的` : '';
      return `<button class="item" data-act="open-expense" data-trip="${esc(x.trip.id)}" data-id="${esc(e.id)}">
        <span class="ic">${x.type === 'item' ? '🏷️' : cat.icon}</span>
        <span class="mid"><div class="t">${esc(title)}</div>
          ${orig ? `<div class="s">${esc(orig)}</div>` : ''}
          <div class="s">${dayLabel(e.date)} · ${flag(x.trip.currency)} ${esc(x.trip.name)}${x.type === 'item' && e.title ? ' · ' + esc(e.title) : ''}${owners}</div></span>
        <span class="amt">${e.amountPending && x.type !== 'item' ? '<div class="tw"><span class="tag warn">金額待補</span></div>' : `<div class="f">${money(x.amount, x.cur)}${x.qty > 1 ? `<small class="muted"> ×${x.qty}</small>` : ''}</div>${x.cur !== 'TWD' && x.twd != null && !e.amountPending ? `<div class="tw">≈ ${twd(x.twd)}</div>` : ''}`}</span>
      </button>`;
    }).join('')}</div>`;
}

/* ---------- 統計 ---------- */
function bars(rows, fmtVal, labelFn) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="bars">${rows.map(([k, v]) => `
    <div class="bar-row">
      <span class="bar-label">${labelFn(k)}</span>
      <span class="bar-track"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></span>
      <span class="bar-val">${fmtVal(v)}</span>
    </div>`).join('')}</div>`;
}

export function statsTab() {
  const trips = allTrips();
  const years = [...new Set(trips.map((d) => (d.trip.startDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const st = ledgerStats(trips, { year: S.statsYear, memberId: S.statsMember });
  const mlist = ledgerMembers();
  const who = S.statsMember === 'all' ? '全部旅伴' : memberName(S.statsMember);
  return `
    <div class="chips">
      <button class="chip ${S.statsYear === 'all' ? 'on' : ''}" data-act="stats-year" data-v="all">全部年份</button>
      ${years.map((y) => `<button class="chip ${S.statsYear === y ? 'on' : ''}" data-act="stats-year" data-v="${y}">${y}</button>`).join('')}
    </div>
    <div class="chips">
      <button class="chip ${S.statsMember === 'all' ? 'on' : ''}" data-act="stats-member" data-v="all">全部旅伴</button>
      ${mlist.map((m) => `<button class="chip av-chip ${S.statsMember === m.id ? 'on' : ''}" data-act="stats-member" data-v="${esc(m.id)}">${avatar(m, 20)} ${esc(m.name)}</button>`).join('')}
    </div>
    <div class="stat-tiles">
      <div class="tile"><div class="k">${S.statsMember === 'all' ? '總花費' : esc(who) + '的花費'}</div><div class="v">${twd(st.total)}</div></div>
      <div class="tile"><div class="k">旅程</div><div class="v">${st.trips.length} <small>趟</small></div></div>
      <div class="tile"><div class="k">天數</div><div class="v">${st.days} <small>天</small></div></div>
      <div class="tile"><div class="k">平均每天</div><div class="v">${st.days ? twd(st.total / st.days) : '—'}</div></div>
    </div>
    <p class="small muted">金額都換算成台幣（外幣用各趟的結算匯率）以便比較。${st.noRate ? `有 ${st.noRate} 筆外幣因為沒有匯率，沒算進來。` : ''}</p>
    ${!st.trips.length ? '<div class="card empty">還沒有資料</div>' : `
    ${st.byYear.length > 1 ? `<div class="card"><h3>每年花費</h3>${bars(st.byYear, twd, esc)}</div>` : ''}
    <div class="card"><h3>各趟旅程</h3>
      ${st.trips.map((t) => `
        <button class="trip-stat" data-act="open-trip" data-id="${esc(t.trip.id)}">
          <div class="ts-head"><b>${flag(t.trip.currency)} ${esc(t.trip.name)}</b><b>${twd(t.twd)}</b></div>
          <div class="small muted">${t.trip.startDate ? esc(fmtRange(t.trip.startDate, t.trip.endDate)) : ''}${t.perDay ? ` · 每天 ${twd(t.perDay)}` : ''}</div>
          <div class="small">${moneyMulti(t.local)}${t.rate ? ` <span class="muted">· 匯率 ${rateStr(t.rate)}</span>` : ''}</div>
        </button>`).join('')}
    </div>
    ${st.byCountry.length > 1 ? `<div class="card"><h3>各國家／地區</h3>${bars(st.byCountry, twd, (c) => `${flag(c)} ${esc(countryName(c))}`)}</div>` : ''}
    ${st.byCat.length ? `<div class="card"><h3>各分類</h3>${bars(st.byCat, twd, (c) => `${catOf(c).icon} ${catOf(c).name}`)}</div>` : ''}
    ${S.statsMember === 'all' && st.byMember.length > 1 ? `<div class="card"><h3>每位旅伴的花費</h3>${bars(st.byMember, twd, (id) => `${avatar(member(id), 20)} ${esc(memberName(id))}`)}</div>` : ''}
    ${st.topItems.length ? `<div class="card"><h3>最常買的品項</h3><div class="opts">${st.topItems.map(([k, n]) => `<button class="chip" data-act="quick-search" data-q="${esc(k)}">${esc(k)} <span class="muted">×${n}</span></button>`).join('')}</div></div>` : ''}
    `}
    <button class="btn secondary" data-act="export-csv">⬇️ 匯出全部帳目（Excel / CSV）</button>`;
}

/* ---------- 帳本設定 ---------- */
export function ledgerSettingsTab() {
  const { ledger } = S.ld;
  const me = getMe();
  const shareUrl = location.origin + location.pathname + '?join=' + ledger.id;
  const others = myLedgers().filter((x) => x.id !== ledger.id);
  return `
    <div class="card">
      <h3 class="h-row">帳本 <button class="btn small secondary" data-act="rename-ledger">✏️ 編輯名稱</button></h3>
      <div class="field" style="display:flex;gap:8px"><input id="ledger-name" value="${esc(ledger.name)}" aria-label="帳本名稱">
        <button class="btn small secondary" data-act="save-ledger-name">儲存</button></div>
      <div class="small muted">帳本代碼（旅伴加入、換手機時都用這個）</div>
      <div class="code" style="margin:6px 0 10px">${esc(ledger.id)}</div>
      <div class="row2"><button class="btn secondary" data-act="copy-code">複製代碼</button>
        <button class="btn secondary" data-act="share" data-url="${esc(shareUrl)}">邀請旅伴</button></div>
      <p class="small muted">💡 建議把代碼存到 iPhone 的「備忘錄」（會透過 iCloud 同步）。換新手機時，打開 App 輸入代碼，所有旅程都會回來。</p>
    </div>
    <div class="card">
      <h3>成員（${ledgerMembers().length} 人）</h3>
      ${ledgerMembers().map((m) => `
        <button class="member-line" data-act="edit-member" data-id="${esc(m.id)}">
          ${avatar(m, 38)}<span class="mid">${esc(m.name)}${m.id === me ? ' <span class="tag">我</span>' : ''}</span><span class="muted">編輯 ›</span>
        </button>`).join('')}
      <button class="btn secondary" style="margin-top:10px" data-act="add-member">＋ 新增成員</button>
    </div>
    <div class="card">
      <h3>這支手機的使用者</h3>
      <div class="opts">${ledgerMembers().map((m) => `
        <button class="chip av-chip ${m.id === me ? 'on' : ''}" data-act="set-me" data-id="${esc(m.id)}">${avatar(m, 22)} ${esc(m.name)}</button>`).join('')}</div>
    </div>
    <div class="card">
      <h3>🎨 外觀</h3>
      <div class="theme-grid">${THEMES.map((t) => `
        <button class="theme-opt ${getTheme() === t.id ? 'on' : ''}" data-act="set-theme" data-id="${t.id}">
          <span class="sw"><i style="background:${t.sw[0]}"></i><i style="background:${t.sw[2]}"></i><b style="background:${t.sw[1]}"></b></span>
          <span class="tn">${esc(t.name)}</span><small>${esc(t.desc)}</small>
        </button>`).join('')}</div>
      <div class="seg" style="margin-top:12px">${MODES.map(([k, n]) => `
        <label class="opt"><input type="radio" name="tmode" value="${k}" data-act="set-mode" ${getMode() === k ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      <p class="small muted">每個主題都有淺色和深色版。「跟隨系統」會在 iPhone 切到深色模式時自動換成深色版。外觀只存在這支手機，不會影響旅伴。</p>
    </div>
    <div class="card">
      <h3>收據辨識</h3>
      <div class="seg" style="margin-bottom:10px">
        <label class="opt"><input type="radio" name="ocrEngine" value="auto" data-act="ocr-engine" ${ls.get('tl_ocrEngine', 'auto') === 'auto' ? 'checked' : ''}><span>Gemini 優先</span></label>
        <label class="opt"><input type="radio" name="ocrEngine" value="local" data-act="ocr-engine" ${ls.get('tl_ocrEngine', 'auto') === 'local' ? 'checked' : ''}><span>只用手機辨識</span></label>
      </div>
      <label class="switch-row"><span>拍完第一張自動辨識</span>
        <input type="checkbox" data-act="toggle-autoocr" ${ls.get('tl_autoOcr', true) ? 'checked' : ''}></label>
      <label class="switch-row" style="margin-top:8px"><span>保存收據照片<small class="muted" style="display:block;font-size:12px">關閉後，照片只用來辨識，存檔時不留下（比較省空間）</small></span>
        <input type="checkbox" data-act="toggle-keepreceipt" ${ls.get('tl_keepReceipt', true) ? 'checked' : ''}></label>
      <p class="small muted">${S.store.mode === 'firebase'
        ? 'Gemini 需要網路，會同時把品名翻成中文；沒網路時自動改用手機辨識，品名等連上網路再補翻譯。'
        : '目前是本機模式，Gemini 要設定 Firebase 後才能用，現在只會用手機辨識。'}</p>
      ${S.store.mode === 'firebase' ? '<button class="btn secondary" data-act="ai-test">🔍 測試 Gemini 連線</button><div id="ai-test-out"></div>' : ''}
    </div>
    <div class="card">
      <h3>備份</h3>
      <p class="small muted" style="margin-top:-4px">資料本來就存在雲端；備份檔是多一份保險，可以「儲存到檔案」放進 iCloud 雲碟。</p>
      <label class="switch-row" style="margin-bottom:10px"><span>備份包含收據照片（檔案會比較大）</span><input type="checkbox" id="bk-receipts"></label>
      <button class="btn secondary" data-act="export-backup">⬇️ 匯出整本帳本備份</button>
      <button class="btn secondary" data-act="export-csv">⬇️ 匯出帳目（Excel / CSV）</button>
      <button class="btn secondary" data-act="import-backup">⬆️ 從備份檔還原（建立一本新帳本）</button>
    </div>
    <div class="card">
      <h3>我的其他帳本</h3>
      ${others.map((l) => `<button class="member-line" data-act="switch-ledger" data-id="${esc(l.id)}"><span class="trip-flag">📒</span><span class="mid">${esc(l.name)}</span><span class="muted">切換 ›</span></button>`).join('') || '<p class="small muted">只有這一本</p>'}
      <div class="row2" style="margin-top:10px"><button class="btn secondary" data-act="new-ledger">＋ 建立帳本</button>
        <button class="btn secondary" data-act="join-ledger">加入帳本</button></div>
    </div>
    <div class="card">
      <h3>🗑 最近刪除</h3>
      <p class="small muted" style="margin-top:-4px">刪除的旅程會保留 ${30} 天，期間可以復原或立即永久刪除。</p>
      <button class="btn secondary" data-act="open-trash">打開最近刪除（${deletedTrips().length}）</button>
    </div>
    <div class="card">
      <button class="btn danger" data-act="forget-ledger">從這支手機移除此帳本</button>
      <button class="btn danger" data-act="delete-ledger">🗑 刪除整本帳本（所有人）</button>
      <p class="small muted">「移除」只是這支手機不再顯示，之後可再用代碼加入；「刪除」會放進最近刪除保留 30 天，期間所有成員都可以復原。</p>
    </div>
    <div class="card">
      <h3>版本</h3>
      <div class="kv"><span class="k">目前版本</span><span class="v" id="app-build">${esc(appBuild.value || 'v5.3')}</span></div>
      <p class="small muted">App 會在背景自動檢查新版，有新版時畫面下方會出現「點此更新」。</p>
      <button class="btn secondary" data-act="check-update">🔄 檢查更新</button>
    </div>
    <p class="small muted center">${S.store.mode === 'firebase' ? `☁️ 雲端同步${S.store.appCheck ? ' · 🛡️ App Check' : ''}` : '📱 本機模式'} · v5.3</p>`;
}
