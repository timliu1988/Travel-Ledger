// Gemini（免費版）：收據辨識 + 品名翻譯成繁體中文
// 透過 Firebase AI Logic 呼叫 Gemini Developer API 的免費方案，不需要信用卡。
// 需要網路；沒網路時 app.js 會改用手機上的 Tesseract 辨識，之後再補翻譯。
import { FIREBASE_VERSION } from './store.js';

// 依序嘗試：第一個的免費額度用完時自動換下一個。Google 推出新模型時改這裡即可。
const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
let firebaseApp = null;
let aiPromise = null;
let lastModel = ''; // 最近一次實際用到的模型（顯示在辨識結果上）

/** 'gemini-3.5-flash-lite' → '3.5 Flash-Lite' */
export const modelLabel = (id) => String(id || '').replace(/^gemini-/, '').split('-')
  .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join(' ').replace(' Lite', '-Lite');

/** store.js 建立 Firebase 後呼叫，把 app 交給這裡共用 */
export function setFirebaseApp(app) { firebaseApp = app; }

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

/** 某個模型太久沒回應（尖峰時段可能卡很久），就放棄改試下一個 */
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout：超過 ${ms / 1000} 秒沒回應`)), ms))]);

/** 依序嘗試模型：第一個額度用完（429）或暫時不能用時，換下一個 */
async function generate(parts) {
  if (window.__tlAiMock) return window.__tlAiMock(parts);
  const { m, ai } = await getAiModule();
  let lastErr;
  const tried = [];
  for (const name of MODELS) {
    try {
      const model = m.getGenerativeModel(ai, {
        model: name,
        generationConfig: { responseMimeType: 'application/json' }, // Gemini 3 不支援 temperature 等參數，不要加
      });
      const res = await withTimeout(model.generateContent(parts), 45000);
      lastModel = name;
      return res.response.text();
    } catch (e) {
      lastErr = e;
      tried.push(`${name}：${shortErr(e)}`);
      console.warn('Gemini', name, e);
      const msg = String(e?.message || e);
      if (!/429|quota|RESOURCE_EXHAUSTED|500|503|UNAVAILABLE|high demand|overloaded|timeout|not found|404/i.test(msg)) break;
    }
  }
  const err = friendly(lastErr);
  err.detail = tried.join('\n');
  throw err;
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return new Error('Gemini 免費額度暫時用完，請稍後再試');
  if (/SERVICE_DISABLED|has not been used|is disabled|API_KEY_SERVICE_BLOCKED|blocked/i.test(msg)) return new Error('Firebase 專案的 AI Logic API 沒有啟用，或 API 金鑰被限制');
  if (/api.*not.*enabled|PERMISSION_DENIED|403/i.test(msg)) return new Error('沒有權限使用 Gemini（AI Logic 沒啟用，或 API 金鑰／App Check 擋住了）');
  if (/404|not found/i.test(msg)) return new Error('找不到可用的 Gemini 模型');
  if (/500|503|high demand|overloaded|UNAVAILABLE|timeout/i.test(msg)) return new Error('Gemini 目前太忙或沒回應，請稍後再試');
  if (/App Check/i.test(msg)) return new Error('App Check 驗證沒通過（檢查 firebase-config.js 的 appCheckSiteKey）');
  if (/Failed to fetch|network|NetworkError/i.test(msg)) return new Error('網路連線失敗');
  return new Error('Gemini 辨識失敗：' + shortErr(e).slice(0, 120));
}

/** 設定頁的「測試 Gemini 連線」：每個模型各送一句很短的話，回報各自的結果 */
export async function aiDiagnose() {
  if (!firebaseApp) return [{ model: '—', ok: false, msg: '目前是本機模式，沒有設定 Firebase' }];
  if (!navigator.onLine) return [{ model: '—', ok: false, msg: '目前沒有網路' }];
  let mod;
  try { mod = await getAiModule(); } catch (e) { return [{ model: '—', ok: false, msg: '下載 Gemini 程式庫失敗：' + shortErr(e) }]; }
  const out = [];
  for (const name of MODELS) {
    const t = Date.now();
    try {
      const model = mod.m.getGenerativeModel(mod.ai, { model: name });
      const res = await withTimeout(model.generateContent('只回答兩個字：正常'), 20000);
      out.push({ model: name, ok: true, msg: `${res.response.text().trim().slice(0, 20)}（${((Date.now() - t) / 1000).toFixed(1)} 秒）` });
    } catch (e) {
      out.push({ model: name, ok: false, msg: shortErr(e) });
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
export async function aiReadReceipt(dataUrls, currency) {
  const prompt = `你是記帳助理。以下 ${dataUrls.length} 張照片${dataUrls.length > 1 ? '是「同一張長收據」由上到下分段拍攝的連續片段，相鄰片段可能有重疊的行，重疊的品項只能算一次' : '是一張收據'}。
這趟旅行的當地貨幣是 ${currency}。請讀出收據內容，只回傳 JSON，格式如下：
{
  "store": "店名（原文）",
  "storeZh": "店名的台灣常用中文名稱，例如 マツモトキヨシ → 松本清；沒有慣用名就音譯或保留原文",
  "date": "YYYY-MM-DD 或 null",
  "currency": "ISO 幣別代碼，例如 JPY",
  "total": 實際應付總額（數字，含稅，不含找零與預付金額）,
  "category": "以下其一：${CATS}",
  "items": [
    { "name": "品名原文（照收據上的字，半形片假名請轉成全形）",
      "nameZh": "繁體中文（台灣用語）的品名：用台灣慣用的商品或品牌名稱，並在括號內簡短說明是什麼，例如「克潰精α（腸胃藥）」「Calbee 薯條三兄弟（零食）」；看不出是什麼就直譯",
      "qty": 數量（沒寫就 1）,
      "amount": 這一行的金額小計（數字；折扣、優惠用負數）}
  ]
}
規則：
- items 只放商品、服務與折扣；不要放小計、合計、稅額、找零、付款方式、點數、收據編號。
- 若是「外稅」收據，稅額不要放進 items，total 要含稅。
- 金額只能是數字，不要千分位符號或貨幣符號。
- 看不清楚的欄位用 null，不要猜。`;
  const parts = [prompt, ...dataUrls.map((u) => ({
    inlineData: { mimeType: 'image/jpeg', data: u.split(',')[1] },
  }))];
  const r = parseJson(await generate(parts));
  const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')));
  return {
    engine: 'gemini',
    model: window.__tlAiMock ? 'gemini-mock' : lastModel,
    store: r.store || '',
    storeZh: r.storeZh || '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null,
    currency: /^[A-Z]{3}$/.test(r.currency || '') ? r.currency : null,
    total: isFinite(num(r.total)) && num(r.total) > 0 ? num(r.total) : null,
    category: ['food', 'transport', 'stay', 'shopping', 'fun', 'other'].includes(r.category) ? r.category : null,
    items: (Array.isArray(r.items) ? r.items : [])
      .map((it) => ({ name: String(it.name || '').slice(0, 60), nameZh: String(it.nameZh || '').slice(0, 60), amount: num(it.amount) }))
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
