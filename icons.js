// 線條圖示：選了 A～E 主題時，把畫面上的 emoji 圖示換成一致風格的 SVG 線條圖示。
// 「預設」主題不使用（保留原本的 emoji）。顏色與粗細由各主題的 CSS 決定。
const P = {
  list: '<rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  settle: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  exchange: '<circle cx="9" cy="9" r="5.5"/><path d="M15.2 9.6a5.5 5.5 0 1 1-5.6 5.6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  suitcase: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M8 7v13M16 7v13"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.2" height="6.5" rx="1"/><rect x="10.4" y="5" width="3.2" height="12.5" rx="1"/><rect x="15.8" y="13.5" width="3.2" height="4" rx="1"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Zm0 15A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
  food: '<path d="M7 3v7.5M4.8 3v4.8a2.2 2.2 0 0 0 4.4 0V3M7 10.5V21M17.5 21V3c-2.3 1-3.5 3.3-3.5 7 0 2.5 1.2 3.5 3.5 3.5"/>',
  transport: '<rect x="5" y="3" width="14" height="14" rx="3.5"/><path d="M5 10.5h14M8.5 21l1.2-4M15.5 21l-1.2-4"/><circle cx="8.8" cy="13.8" r=".9" fill="currentColor"/><circle cx="15.2" cy="13.8" r=".9" fill="currentColor"/>',
  stay: '<path d="M3 19.5v-14M3 15h18v4.5M21 15v-2.5a3 3 0 0 0-3-3h-7V15"/><circle cx="7" cy="11.5" r="2"/>',
  shopping: '<path d="M5.5 8h13l-1 12.5h-11Z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  fun: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4Z"/><path d="M14.5 7.5v9" stroke-dasharray="1.6 2.2"/>',
  other: '<path d="M3.5 7.5 12 3.2l8.5 4.3v9L12 20.8l-8.5-4.3Z"/><path d="M3.5 7.5 12 11.8l8.5-4.3M12 11.8v9"/>',
  none: '<path d="M12 20h8.5"/><path d="M16.2 4a2 2 0 0 1 2.9 2.9L7.5 18.5 3.8 19.5l1-3.7Z"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  receipt: '<path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0M15.5 5.5a3.2 3.2 0 0 1 0 6.2M17.5 14.5a6 6 0 0 1 3.7 5.5"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16.5" height="11.5" rx="2.5"/><circle cx="16" cy="13.8" r="1.2" fill="currentColor"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  pen: '<path d="M16.2 4a2 2 0 0 1 2.9 2.9L7.5 18.5 3.8 19.5l1-3.7Z"/>',
  box: '<path d="M3.5 7.5 12 3.2l8.5 4.3v9L12 20.8l-8.5-4.3Z"/><path d="M3.5 7.5 12 11.8l8.5-4.3M12 11.8v9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z"/><circle cx="12" cy="12.5" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>',
  clip: '<rect x="6" y="4" width="12" height="17" rx="2.5"/><path d="M9.5 4V3h5v1M9.5 10h5M9.5 14h5"/>',
  hand: '<path d="M12 21a7 7 0 0 1-7-7V9a1.5 1.5 0 0 1 3 0v3V5a1.5 1.5 0 0 1 3 0v6V4a1.5 1.5 0 0 1 3 0v7V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7Z"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  party: '<path d="M4 20 8.5 7.5l8 8Z"/><path d="M14 4.5c.5 1.5 0 3-1.5 3.5M19.5 10c-1.5-.5-3 0-3.5 1.5M17 3.5v1.5M20.5 6.5h-1.5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0Z"/><circle cx="8" cy="8" r="1.4"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-1 .8-1.7 1.9-1.7h2.3a3.5 3.5 0 0 0 3.5-3.5C20.5 6.9 16.7 3.5 12 3.5Z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10" cy="7.3" r="1.1" fill="currentColor"/><circle cx="14.5" cy="7.3" r="1.1" fill="currentColor"/>',
};
// emoji → 圖示名稱（類別 class 讓主題可以分別上色）
const MAP = {
  '📒': 'list', '🤝': 'settle', '💱': 'exchange', '⚙️': 'settings', '⚙': 'settings', '🧳': 'suitcase', '🔍': 'search', '📊': 'chart',
  '🍜': 'food', '🚃': 'transport', '🏨': 'stay', '🛍️': 'shopping', '🛍': 'shopping', '🎡': 'fun', '📦': 'box', '📝': 'none',
  '💵': 'cash', '💳': 'card', '🧾': 'receipt', '👥': 'people', '👛': 'wallet', '🗑': 'trash', '✏️': 'pen', '✏': 'pen', '📄': 'copy',
  '📷': 'camera', '🖼️': 'image', '🖼': 'image', '📋': 'clip', '🙋': 'person', '🎉': 'party', '⚠️': 'warn', '⚠': 'warn', '⋯': 'more', '🏷️': 'tag', '🏷': 'tag', '⬇️': 'download', '⬇': 'download', '⬆️': 'upload', '⬆': 'upload', '🔄': 'refresh', '🎨': 'palette', '☀️': 'sun', '☀': 'sun', '🌙': 'moon',
};
const keys = Object.keys(MAP).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const RE = new RegExp(`(${keys.join('|')})\\uFE0F?`, 'g');
const svg = (name) => `<svg class="ico ico-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

let busy = false;
let observer = null;
function run(root) {
  if (busy) return;
  busy = true;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script,style,textarea,option,svg,.no-ico') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const hits = [];
  while (w.nextNode()) { RE.lastIndex = 0; if (RE.test(w.currentNode.nodeValue)) hits.push(w.currentNode); }
  for (const n of hits) {
    const span = document.createElement('span');
    span.innerHTML = n.nodeValue.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(RE, (m, k) => svg(MAP[k]));
    n.replaceWith(...span.childNodes);
  }
  document.querySelectorAll('.fab').forEach((f) => { if (!f.querySelector('svg')) f.innerHTML = svg('plus'); });
  // 類別圖示外框加上分類名稱，讓主題可以依分類上色
  document.querySelectorAll('.item .ic').forEach((ic) => {
    const s = ic.querySelector(':scope > .ico');
    if (s) ic.dataset.cat = [...s.classList].find((c) => c.startsWith('ico-') && c !== 'ico')?.slice(4) || '';
  });
  busy = false;
}

export function startIcons() {
  if (observer) return;
  run(document.body);
  observer = new MutationObserver(() => run(document.body));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
export function stopIcons() {
  observer?.disconnect();
  observer = null;
}
