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

/** 依序嘗試模型：第一個額度用完（429）或暫時不能用時，換下一個 */
async function generate(parts) {
  if (window.__tlAiMock) return window.__tlAiMock(parts);
  const { m, ai } = await getAiModule();
  let lastErr;
  for (const name of MODELS) {
    try {
      const model = m.getGenerativeModel(ai, {
        model: name,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      });
      const res = await model.generateContent(parts);
      lastModel = name;
      return res.response.text();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (!/429|quota|RESOURCE_EXHAUSTED|503|UNAVAILABLE|not found|404/i.test(msg)) break;
    }
  }
  throw friendly(lastErr);
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return new Error('Gemini 免費額度暫時用完，請稍後再試（已可改用手機辨識）');
  if (/api.*not.*enabled|PERMISSION_DENIED|403/i.test(msg)) return new Error('Firebase 專案還沒啟用 AI Logic（見安裝教學第 1-5 步）');
  if (/Failed to fetch|network/i.test(msg)) return new Error('網路連線失敗');
  return new Error('Gemini 辨識失敗：' + msg.slice(0, 120));
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
