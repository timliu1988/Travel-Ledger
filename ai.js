// Gemini（免費版）：收據辨識 + 品名翻譯成繁體中文
// 透過 Firebase AI Logic 呼叫 Gemini Developer API 的免費方案，不需要信用卡。
// 需要網路；沒網路時 app.js 會改用手機上的 Tesseract 辨識，之後再補翻譯。
import { FIREBASE_VERSION } from './store.js';

// 內建的免費模型（2026/11 依 Google AI Studio 的免費額度更新）。「自動」模式由上往下試，失敗就換下一個。
// rpd：免費版每天可用次數（AI Studio → Rate limit 頁面）；timeout：在「自動」裡最多等幾秒。
// Google 推出新模型時改這裡即可；也可以在 App 的「帳本 → 收據辨識 → 辨識用的模型」自訂模型名稱。
// 注意：gemini-3.5-flash 已停用並轉到 3.6 Flash（會重複扣 3.6 的額度），所以不放進清單。
export const MODELS = [
  { id: 'gemini-4-hydrogen', note: '最新、推薦', rpd: 20, timeout: 60 },
  { id: 'gemini-3.6-flash', note: '穩定', rpd: 20, timeout: 60 },
  { id: 'gemini-3.8-flash', note: '常超時，已調低思考量', rpd: 20, timeout: 60, think: 'LOW' },
  { id: 'gemini-3.5-flash-lite', note: '輕量、每天 500 次', rpd: 500, timeout: 45 },
  { id: 'gemini-3.1-flash-lite', note: '輕量、舊版', rpd: 500, timeout: 45 },
];
const AUTO = MODELS.map((x) => x.id);
const infoOf = (id) => MODELS.find((x) => x.id === id) || { id, rpd: null, timeout: 60 };
const MANUAL_TIMEOUT = 90; // 手動指定的模型最多等 90 秒
const SKIP_MIN = 30;       // 「自動」模式裡，最近失敗的模型暫時跳過 30 分鐘
let firebaseApp = null;
let aiPromise = null;
let lastModel = ''; // 最近一次實際用到的模型（顯示在辨識結果上）
let lastSkipped = []; // 這次辨識前面失敗、被跳過的模型 [{ id, why }]

/* ---------- 這支手機記住的：今天用了幾次、哪些模型暫時跳過 ---------- */
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
/** 免費額度以美國太平洋時間的日期計算（台灣時間下午 3～4 點重置） */
const ptDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
export function usageToday() {
  const u = lsGet('tl_aiUse', null);
  return u && u.day === ptDay() ? u.counts || {} : {};
}
function countUse(id) {
  const counts = usageToday();
  counts[id] = (counts[id] || 0) + 1;
  lsSet('tl_aiUse', { day: ptDay(), counts });
}
const skipMap = () => { const m = lsGet('tl_aiSkip', {}); const now = Date.now(); return Object.fromEntries(Object.entries(m).filter(([, v]) => v.until > now)); };
function setSkip(id, why, minutes) { const m = skipMap(); m[id] = { until: Date.now() + minutes * 60000, why }; lsSet('tl_aiSkip', m); }
function clearSkip(id) { const m = skipMap(); if (m[id]) { delete m[id]; lsSet('tl_aiSkip', m); } }
/** 現在「自動」會不會跳過這個模型：最近失敗，或這支手機今天已用到免費上限 */
export function skipReason(id) {
  const s = skipMap()[id];
  if (s) return s.why;
  const lim = infoOf(id).rpd;
  if (lim && (usageToday()[id] || 0) >= lim) return '今天額度用完';
  return '';
}

/** 使用者在設定選的模型：'auto' 或模型 id */
export function preferredModel() {
  const v = lsGet('tl_aiModel', '');
  // 舊版設定過的 3.5 Flash 已停用，改回自動
  return v && v !== 'gemini-3.5-flash' && /^[\w.\-]+$/.test(v) ? v : 'auto';
}

/** 'gemini-3.5-flash-lite' → '3.5 Flash-Lite' */
export const modelLabel = (id) => String(id || '').replace(/^gemini-/, '').split('-')
  .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join(' ').replace(' Lite', '-Lite');

/** store.js 建立 Firebase 後呼叫，把 app 交給這裡共用 */
export function setFirebaseApp(app) { firebaseApp = app; }
let appCheckRef = null; // { inst, mod } 或 { error }
export function setAppCheck(x) { appCheckRef = x; }

/** 現在能不能用 Gemini（有設定 Firebase、有網路） */
export function aiReady() {
  if (window.__tlAiMock) return navigator.onLine;
  return !!firebaseApp && navigator.onLine;
}

function getAiModule() {
  aiPromise ||= import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-ai.js`)
    .then((m) => ({ m, ai: m.getAI(firebaseApp, { backend: new m.GoogleAIBackend() }) }))
    .catch((e) => { aiPromise = null; throw e; });
  return aiPromise;
}

/** 錯誤訊息去掉很長的網址，留下狀態碼和原因，方便看出問題 */
export const shortErr = (e) => String(e?.message || e)
  .replace(/https:\/\/\S+?(:generateContent|:countTokens)?(?=[:\s]|$)/g, '')
  .replace(/^AI:\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 300);

/** 錯誤分類：決定要換模型、暫停多久、顯示什麼 */
function classify(e) {
  const msg = String(e?.message || e);
  if (e?.userSkip) return { kind: 'user', why: '已手動略過', retry: true };
  if (/limit:\s*0\b/i.test(msg)) return { kind: 'nofree', why: '免費版不能用', retry: true, skip: 24 * 60 };
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    if (/per\s*minute|PerMinute|RPM/i.test(msg) && !/per\s*day|PerDay/i.test(msg)) {
      const m = msg.match(/retry in ([\d.]+)\s*s|retryDelay["':\s]*"?([\d.]+)s/i);
      return { kind: 'rpm', why: '每分鐘上限', retry: true, wait: Math.min(30, Math.ceil(Number(m?.[1] || m?.[2] || 20)) + 1) };
    }
    return { kind: 'rpd', why: '今天額度用完', retry: true, skip: 6 * 60 };
  }
  if (/timeout/i.test(msg)) return { kind: 'timeout', why: '太久沒回應', retry: true, skip: SKIP_MIN };
  if (/500|503|high demand|overloaded|UNAVAILABLE/i.test(msg)) return { kind: 'busy', why: '忙碌', retry: true, skip: SKIP_MIN };
  if (/404|not found|is not supported|deprecated|no longer available/i.test(msg)) return { kind: 'gone', why: '已停用或找不到這個模型', retry: true, skip: 24 * 60 };
  if (/thinking/i.test(msg) && /400|INVALID_ARGUMENT|Invalid/i.test(msg)) return { kind: 'badcfg', why: '不支援思考量設定', retry: true };
  return { kind: 'other', why: '失敗', retry: false };
}

/** 試的順序：指定的模型先試；「自動」時跳過最近失敗、今天已用完的（全部都被跳過時就照原順序試） */
function plan(pick) {
  const manual = pick && pick !== 'auto' ? pick : null;
  const rest = AUTO.filter((x) => x !== manual);
  const ok = rest.filter((x) => !skipReason(x));
  const skipped = rest.filter((x) => skipReason(x)).map((x) => ({ id: x, why: '暫時跳過（' + skipReason(x) + '）' }));
  return { order: [...(manual ? [manual] : []), ...(ok.length ? ok : rest)], skipped: ok.length ? skipped : [], manual };
}

/** 呼叫一個模型一次。onTick 回報等待秒數；ctl.skip() 可以讓使用者中途放棄改用下一個 */
async function callOnce(name, parts, ms, ctl, noThink) {
  const info = infoOf(name);
  let p;
  if (window.__tlAiMock) p = Promise.resolve().then(() => window.__tlAiMock(parts, name));
  else {
    const { m, ai } = await getAiModule();
    const generationConfig = { responseMimeType: 'application/json' }; // Gemini 3 以後不支援 temperature 等參數，不要加
    if (info.think && !noThink && !String(parts[0]).startsWith('只回答')) generationConfig.thinkingConfig = { thinkingLevel: info.think };
    const model = m.getGenerativeModel(ai, { model: name, generationConfig });
    p = model.generateContent(parts).then((res) => res.response.text());
  }
  countUse(name); // 送出就算一次（超時、被拒絕也會扣 Google 的額度）
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => ctl?.onTick?.(name, Math.floor((Date.now() - t0) / 1000)), 1000);
    const done = (f, v) => { clearInterval(tick); clearTimeout(to); if (ctl) ctl.skip = null; f(v); };
    const to = setTimeout(() => done(reject, new Error(`timeout：超過 ${ms / 1000} 秒沒回應`)), ms);
    if (ctl) ctl.skip = () => { const e = new Error('使用者改用其他模型'); e.userSkip = true; done(reject, e); };
    p.then((v) => done(resolve, v), (e) => done(reject, e));
  });
}

/**
 * 依序嘗試模型。
 * @param {Array} parts
 * @param {string} [pick]  這次指定的模型（換模型辨識時）；沒給就用設定
 * @param {{onTick?, onStatus?, skip?}} [ctl]  等待畫面用
 */
async function generate(parts, pick, ctl) {
  lastSkipped = [];
  const { order, skipped, manual } = plan(pick || preferredModel());
  lastSkipped.push(...skipped);
  let lastErr;
  const tried = [];
  for (const [i, name] of order.entries()) {
    const isManual = name === manual;
    const ms = (isManual ? MANUAL_TIMEOUT : (infoOf(name).timeout || 60)) * 1000 * (window.__tlAiTimeScale || 1); // TimeScale 只給測試用
    let noThink = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ctl?.onStatus?.({ model: name, phase: 'run', manual: isManual, hasNext: i < order.length - 1 });
        const text = await callOnce(name, parts, ms, ctl, noThink);
        lastModel = name;
        clearSkip(name);
        return text;
      } catch (e) {
        const c = classify(e);
        console.warn('Gemini', name, e);
        if (c.kind === 'badcfg' && !noThink) { noThink = true; continue; } // 這個模型不收思考量設定：不帶設定重試
        if (c.kind === 'rpm' && attempt === 0) {
          // 每分鐘上限：等一下再試同一個模型，不要馬上降級
          for (let s = c.wait; s > 0; s--) { ctl?.onStatus?.({ model: name, phase: 'wait', left: s }); await new Promise((r) => setTimeout(r, 1000 * (window.__tlAiTimeScale || 1))); }
          continue;
        }
        lastErr = e;
        tried.push(`${name}：${c.kind === 'user' ? c.why : shortErr(e)}`);
        lastSkipped.push({ id: name, why: c.why });
        if (c.skip) setSkip(name, c.why, c.skip);
        if (!c.retry) { const err = friendly(lastErr); err.detail = tried.join('\n'); throw err; }
        break;
      }
    }
  }
  const err = friendly(lastErr);
  err.detail = tried.join('\n');
  throw err;
}

export const skippedNote = () => lastSkipped.map((x) => `${modelLabel(x.id)} ${x.why}`).join('、');

function friendly(e) {
  const msg = String(e?.message || e);
  if (/limit:\s*0\b/i.test(msg)) return new Error('這個模型免費版不能用');
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return new Error('Gemini 免費額度暫時用完，請稍後再試');
  if (/SERVICE_DISABLED|has not been used|is disabled|API_KEY_SERVICE_BLOCKED|blocked/i.test(msg)) return new Error('Firebase 專案的 AI Logic API 沒有啟用，或 API 金鑰被限制');
  if (/api.*not.*enabled|PERMISSION_DENIED|403/i.test(msg)) return new Error('沒有權限使用 Gemini（AI Logic 沒啟用，或 API 金鑰／App Check 擋住了）');
  if (/404|not found/i.test(msg)) return new Error('找不到可用的 Gemini 模型（可能已停用）');
  if (/500|503|high demand|overloaded|UNAVAILABLE|timeout|改用其他模型/i.test(msg)) return new Error('Gemini 目前太忙或沒回應，請稍後再試');
  if (/App Check/i.test(msg)) return new Error('App Check 驗證沒通過（檢查 firebase-config.js 的 appCheckSiteKey）');
  if (/Failed to fetch|network|NetworkError/i.test(msg)) return new Error('網路連線失敗');
  return new Error('Gemini 辨識失敗：' + shortErr(e).slice(0, 120));
}

/**
 * 設定頁的「測試 Gemini 連線」：為了省額度，只測一個模型。
 * 指定了模型就測那個；「自動」就照順序試，第一個成功就停。
 */
export async function aiDiagnose() {
  const mock = !!window.__tlAiMock;
  if (!firebaseApp && !mock) return [{ model: '—', ok: false, msg: '目前是本機模式，沒有設定 Firebase' }];
  if (!navigator.onLine) return [{ model: '—', ok: false, msg: '目前沒有網路' }];
  if (!mock) { try { await getAiModule(); } catch (e) { return [{ model: '—', ok: false, msg: '下載 Gemini 程式庫失敗：' + shortErr(e) }]; } }
  const out = [];
  // 先檢查 App Check：AI Logic 已強制執行時，沒拿到驗證就一定會失敗
  if (mock) { /* 測試環境不檢查 */ } else if (!appCheckRef) out.push({ model: 'App Check', ok: false, msg: '這支手機沒有啟用 App Check：GitHub 上的 firebase-config.js 沒有 appCheckSiteKey，或手機還在用舊的設定檔' });
  else if (appCheckRef.error) out.push({ model: 'App Check', ok: false, msg: '啟用失敗：' + shortErr(appCheckRef.error) });
  else {
    const t = Date.now();
    try {
      const r = await Promise.race([appCheckRef.mod.getToken(appCheckRef.inst, true), new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 20000))]);
      out.push({ model: 'App Check', ok: !!r?.token, msg: r?.token ? `已取得驗證（${((Date.now() - t) / 1000).toFixed(1)} 秒）` : '沒有拿到驗證' });
    } catch (e) {
      out.push({ model: 'App Check', ok: false, msg: '取得驗證失敗：' + shortErr(e) });
    }
  }
  const pick = preferredModel();
  const list = pick !== 'auto' ? [pick] : AUTO;
  for (const name of list) {
    const t = Date.now();
    try {
      const txt = await callOnce(name, ['只回答兩個字：正常'], 30000, null, true);
      clearSkip(name);
      out.push({ model: name, ok: true, msg: `${String(txt).replace(/[\[\]"]/g, '').trim().slice(0, 20)}（${((Date.now() - t) / 1000).toFixed(1)} 秒）` });
      break;
    } catch (e) {
      const c = classify(e);
      if (c.skip) setSkip(name, c.why, c.skip);
      out.push({ model: name, ok: false, msg: `${c.why}：${shortErr(e)}` });
    }
  }
  return out;
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(t);
}

const CATS = 'food（餐飲）, transport（交通）, stay（住宿）, shopping（購物）, fun（門票娛樂）, other（其他）';

/**
 * 辨識收據照片（可多張，代表同一張長收據的連續片段）
 * @param {string[]} dataUrls  JPEG data URL
 * @param {string} currency    旅程當地貨幣，供判斷用
 */
export async function aiReadReceipt(dataUrls, currency, pick, ctl) {
  const prompt = `你是記帳助理。以下 ${dataUrls.length} 張照片${dataUrls.length > 1 ? '是「同一張長收據」由上到下分段拍攝的連續片段，相鄰片段可能有重疊的行，重疊的品項只能算一次' : '是一張收據'}。
這趟旅行的當地貨幣是 ${currency}。請讀出收據內容，只回傳 JSON，格式如下：
{
  "store": "店名（原文）",
  "storeZh": "簡短的店名，用台灣慣用的中文名稱，最多加上分店地名，例如 セブン-イレブン 山形幸町店 → 7-11（山形店）、マツモトキヨシ 心斎橋店 → 松本清（心齋橋店）；不要放地址、電話或整串分店全名；沒有慣用中文名就保留原文品牌名",
  "date": "YYYY-MM-DD 或 null",
  "currency": "ISO 幣別代碼，例如 JPY",
  "total": 實際應付總額（數字，含稅，不含找零與預付金額）,
  "category": "以下其一：${CATS}",
  "items": [
    { "name": "品名原文（照收據上的字，半形片假名請轉成全形）",
      "nameZh": "繁體中文（台灣用語）的品名：用台灣慣用的商品或品牌名稱，並在括號內簡短說明是什麼，例如「克潰精α（腸胃藥）」「Calbee 薯條三兄弟（零食）」；看不出是什麼就直譯",
      "qty": 數量（沒寫就 1）,
      "amount": 這一行的金額小計，照收據上印的數字（數字；折扣、優惠用負數）,
      "taxRate": 日本收據才填：這一項的消費稅率 8 或 10（品項旁有「＊」「※」「軽」等軽減稅率記號的是 8，沒有的是 10）；其他國家填 null }
  ],
  "taxMode": "日本收據才填：excluded（外稅：品項是稅抜價格，稅另外列「消費税等」）、included（內稅：品項已含稅）或 none（免稅）；其他國家填 null",
  "taxes": 日本外稅收據才填：每種稅率印出來的稅額，例如 {"8": 37, "10": 0}；收據上有該稅率的品項但沒印稅額就填 0；其他情況填 null
}
規則：
- items 只放商品、服務與折扣；不要放小計、合計、稅額、找零、付款方式、點數、收據編號。
- 若是「外稅」收據，稅額不要放進 items，total 要含稅。
- 金額只能是數字，不要千分位符號或貨幣符號。
- 看不清楚的欄位用 null，不要猜。`;
  const parts = [prompt, ...dataUrls.map((u) => ({
    inlineData: { mimeType: 'image/jpeg', data: u.split(',')[1] },
  }))];
  const r = parseJson(await generate(parts, pick, ctl));
  const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')));
  return {
    engine: 'gemini',
    model: lastModel,
    skipped: skippedNote(),
    store: r.store || '',
    storeZh: r.storeZh || '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null,
    currency: /^[A-Z]{3}$/.test(r.currency || '') ? r.currency : null,
    total: isFinite(num(r.total)) && num(r.total) > 0 ? num(r.total) : null,
    taxMode: ['excluded', 'included', 'none'].includes(r.taxMode) ? r.taxMode : null,
    taxes: r.taxes && typeof r.taxes === 'object' ? Object.fromEntries(Object.entries(r.taxes).filter(([k, v]) => ['8', '10'].includes(String(k)) && isFinite(num(v))).map(([k, v]) => [k, num(v)])) : null,
    category: ['food', 'transport', 'stay', 'shopping', 'fun', 'other'].includes(r.category) ? r.category : null,
    items: (Array.isArray(r.items) ? r.items : [])
      .map((it) => ({ name: String(it.name || '').slice(0, 60), nameZh: String(it.nameZh || '').slice(0, 60), qty: num(it.qty) > 0 ? num(it.qty) : 1, amount: num(it.amount), taxRate: [8, 10].includes(Number(it.taxRate)) ? Number(it.taxRate) : null }))
      .filter((it) => isFinite(it.amount) && it.amount !== 0)
      .slice(0, 80),
    text: JSON.stringify(r, null, 1),
  };
}

/** 只翻譯品名（離線辨識的結果，連上網後補翻譯用） */
export async function aiTranslateNames(names, context = '') {
  if (!names.length) return [];
  const prompt = `以下是${context ? `「${context}」的` : ''}收據品名（可能是日文、韓文、泰文、英文等，也可能有 OCR 辨識錯字）。
請翻成繁體中文（台灣用語）：用台灣慣用的商品或品牌名稱，並在括號內簡短說明是什麼，例如「克潰精α（腸胃藥）」；看不出是什麼就直譯。
只回傳 JSON 陣列，順序與數量和輸入完全相同。
輸入：${JSON.stringify(names)}`;
  const r = parseJson(await generate([prompt]));
  if (!Array.isArray(r) || r.length !== names.length) throw new Error('翻譯結果數量不符');
  return r.map((x) => String(x || '').slice(0, 60));
}
