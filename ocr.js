// 收據文字辨識（OCR）：使用 Tesseract.js，在手機上直接辨識，不需要伺服器或金鑰。
// 第一次使用會下載辨識程式和語言檔（日文約 2～3MB），之後會留在手機裡。
import { prepareForOcr } from './media.js';

const TESS_VERSION = '5.1.1';
const SCRIPT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/tesseract.min.js`;
// worker、辨識核心、語言檔都使用 Tesseract.js 預設的 jsDelivr 網址（每種語言各自一個套件）

// 依當地貨幣決定辨識語言（都加上英文，數字和英文品名才認得出來）
const LANGS = {
  JPY: 'jpn', KRW: 'kor', CNY: 'chi_sim', HKD: 'chi_tra', MOP: 'chi_tra', TWD: 'chi_tra',
  THB: 'tha', VND: 'vie',
};
export const ocrLangFor = (cur) => (LANGS[cur] ? [LANGS[cur], 'eng'] : ['eng']);

let loading = null;
function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error('無法下載辨識程式，請確認網路')); };
    document.head.appendChild(s);
  });
  return loading;
}

let workerCache = { key: null, worker: null };
let progressCb = null;
async function getWorker(langs) {
  const key = langs.join('+');
  if (workerCache.key === key) return workerCache.worker;
  await workerCache.worker?.terminate();
  workerCache = { key: null, worker: null };
  await loadScript();
  const worker = await window.Tesseract.createWorker(langs, 1, { logger: (m) => progressCb?.(m) });
  workerCache = { key, worker };
  return worker;
}

/**
 * 辨識一張或多張（長收據分段拍）照片，回傳 { text, total, items, date }
 * 多段時：每段分別辨識，再把相鄰兩段重疊的品項去掉
 */
export async function recognizeReceipts(imgs, currency, onProgress) {
  const results = [];
  try {
    const worker = await getWorker(ocrLangFor(currency));
    for (let i = 0; i < imgs.length; i++) {
      progressCb = (m) => onProgress?.({ ...m, part: i + 1, parts: imgs.length });
      const { data } = await worker.recognize(prepareForOcr(imgs[i]));
      results.push({ text: data.text, ...parseReceipt(data.text, currency) });
    }
  } finally {
    progressCb = null;
  }
  return mergeParts(results);
}

const normName = (s) => (s || '').replace(/[\s・･\-ー]/g, '').toLowerCase();
function sameItem(a, b) {
  if (Math.abs(a.amount - b.amount) > 0.001) return false;
  const x = normName(a.name), y = normName(b.name);
  if (!x || !y) return true;
  // 名稱有一半以上相同字元就視為同一行（OCR 每次可能差一兩個字）
  const setY = new Set(y);
  const common = [...x].filter((c) => setY.has(c)).length;
  return common / Math.max(x.length, y.length) >= 0.5;
}
export function mergeParts(parts) {
  if (parts.length === 1) return parts[0];
  let items = [];
  for (const p of parts) {
    const next = p.items;
    // 找出「上一段結尾」和「這一段開頭」重疊幾行（最多比對 6 行）
    let overlap = 0;
    for (let k = Math.min(6, items.length, next.length); k > 0; k--) {
      const tail = items.slice(-k), head = next.slice(0, k);
      if (tail.every((it, i) => sameItem(it, head[i]))) { overlap = k; break; }
    }
    items = items.concat(next.slice(overlap));
  }
  const withTotal = [...parts].reverse().find((p) => p.totalExplicit);
  return {
    text: parts.map((p, i) => `── 第 ${i + 1} 段 ──\n${p.text}`).join('\n'),
    total: withTotal?.total ?? parts.at(-1).total,
    date: parts.find((p) => p.date)?.date || null,
    items: items.slice(0, 60),
  };
}

/* ---------------- 離線小字典：常見收據用語 ---------------- */
const DICT = [
  [/値引|割引|ディスカウント|할인|DISCOUNT/i, '折扣'],
  [/レジ袋|袋代|봉투|쇼핑백/, '購物袋'],
  [/ポイント|포인트/, '點數'],
  [/送料/, '運費'],
  [/サービス料|봉사료|SERVICE/i, '服務費'],
  [/免税/, '免稅'],
  [/クーポン|쿠폰|COUPON/i, '優惠券'],
  [/弁当/, '便當'],
  [/おにぎり/, '飯糰'],
  [/コーヒー|커피|COFFEE/i, '咖啡'],
  [/ビール|맥주|BEER/i, '啤酒'],
  [/お茶|緑茶/, '茶'],
  [/水$|ミネラルウォーター|생수|WATER/i, '水'],
  [/パン|빵|BREAD/i, '麵包'],
];
/** 離線時給品項一個粗略的中文提示（找不到回傳空字串） */
export function dictHint(name) {
  for (const [re, zh] of DICT) if (re.test(name || '')) return zh;
  return '';
}

/* ---------------- 解析收據文字 ---------------- */
const TOTAL_WORDS = /(合\s*計|総\s*計|総\s*額|お\s*会\s*計|ご\s*請\s*求|お\s*支\s*払|お買上|TOTAL|Total|AMOUNT\s*DUE|GRAND|합\s*계|총\s*액|결제\s*금액|받을\s*금액|總\s*計|總\s*額|总\s*计|应\s*付|實\s*收|รวม|Tổng)/;
const SUBTOTAL_WORDS = /(小\s*計|SUB\s*-?\s*TOTAL|Subtotal|소\s*계|小\s*计)/i;
const SKIP_WORDS = /(小\s*計|合\s*計|総\s*計|税|消費|対象|内\s*税|外\s*税|お\s*釣|釣\s*銭|お\s*預|預\s*り|現\s*金|クレジット|カード|点\s*数|点$|個$|TOTAL|SUB|TAX|CASH|CHANGE|VISA|MASTER|JCB|AMEX|CARD|PAID|BALANCE|합계|소계|부가세|과세|면세|거스름|받은|카드|현금|找零|稅|税额|現金|信用卡|電話|TEL|Tel|No\.|NO\.|登録番号|レシート|領収|〒|http|www)/i;

// 收據上的數字常帶有 ¥ \ ￥ 円 원 等符號；\ 在日本收據常代表 ¥
const NUM_AT_END = /[¥￥\\$€£₩฿]?\s*(-?\d{1,3}(?:[,，.]\d{3})+|-?\d+)(?:[.,](\d{1,2}))?\s*(?:円|원|元|đ|VND|JPY|KRW)?\s*[*※＊%#]?\s*(?:[A-Z軽外内税]{0,2})?\s*$/;

// OCR 常在中日韓文字之間多插空白，例如「マツ モト キヨ シ」
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af\\uff66-\\uff9f';
const CJK_GAP = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'g');

function toNumber(intPart, dec, currency) {
  const noDecimal = ['JPY', 'KRW', 'VND', 'IDR', 'TWD'].includes(currency);
  let s = intPart.replace(/[，,]/g, '');
  if (noDecimal) s = s.replace(/\./g, ''); // 1.200 在部分國家是千分位
  let n = parseFloat(s);
  if (dec && !noDecimal) n = parseFloat(s + '.' + dec);
  return isFinite(n) ? n : null;
}

export function parseReceipt(text, currency) {
  const lines = text.split(/\n/).map((l) => l.replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [], itemsAfter = []; // 小計／合計之後出現的通常是稅、付款、找零，不是品項
  let ended = false;
  let total = null, subtotal = null, maxNum = 0;
  let date = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // 日期
    if (!date) {
      const m = line.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/);
      if (m) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    const m = line.match(NUM_AT_END);
    if (!m) continue;
    const n = toNumber(m[1], m[2], currency);
    if (n == null || n === 0) continue;
    const label = line.slice(0, m.index).replace(/[¥￥\\@×xX*※]+\s*$/, '').trim()
      .replace(CJK_GAP, '');

    if (TOTAL_WORDS.test(line) && !SUBTOTAL_WORDS.test(line)) {
      if (total == null && n > 0) total = n;
      ended = true;
      continue;
    }
    if (SUBTOTAL_WORDS.test(line)) { if (subtotal == null && n > 0) subtotal = n; ended = true; continue; }
    if (n > maxNum && n < 1e9) maxNum = n;
    if (SKIP_WORDS.test(line)) continue;
    // 品項：前面要有文字（至少 1 個字母或中日韓字），且不是純數字或日期時間
    const letters = label.replace(/[\d\s.,:/\-()（）%#]/g, '');
    if (letters.length < 1) continue;
    if (/\d{1,2}:\d{2}/.test(line)) continue;
    // 折扣（負數或「値引」「割引」「할인」）
    const isDiscount = n < 0 || /(値引|割引|할인|折扣|DISCOUNT|OFF)/i.test(label);
    (ended ? itemsAfter : items).push({ name: label.slice(0, 40), amount: isDiscount ? -Math.abs(n) : n });
  }
  const totalExplicit = total != null;
  if (total == null) total = subtotal ?? (maxNum || null);
  // 金額大於等於總額的不可能是品項（通常是誤認的合計、預付金額）
  const ok = (it) => !(totalExplicit || subtotal) || Math.abs(it.amount) < (total || Infinity);
  // 品項太多通常是辨識到雜訊，只保留前 40 筆
  return { total, totalExplicit, items: (items.length ? items : itemsAfter).filter(ok).slice(0, 40), date };
}
