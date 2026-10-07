// 照片處理：讀檔、裁切頭像、壓縮收據、OCR 前處理

/** 讀取使用者選的照片（瀏覽器會自動依 EXIF 轉正） */
export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    const img = new Image();
    img.onload = () => { resolve(img); if (typeof fileOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => reject(new Error('無法讀取這張照片'));
    img.src = url;
  });
}

/**
 * 頭像：裁成正方形、縮成 256×256。
 * 畫面上最大顯示約 56pt，iPhone 3 倍螢幕需要約 168px，256px 夠清楚，檔案約 15～25KB。
 * zoom ≥ 1 時放大裁切範圍，offsetX/Y（-1～1）調整裁切中心。
 */
export function makeAvatar(img, { zoom = 1, offsetX = 0, offsetY = 0 } = {}) {
  const S = 256;
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  const maxX = (img.naturalWidth - side) / 2, maxY = (img.naturalHeight - side) / 2;
  const sx = maxX + offsetX * maxX, sy = maxY + offsetY * maxY;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
  return c.toDataURL('image/jpeg', 0.85);
}

/**
 * 收據：長邊縮到 1600px 以內，JPEG 壓縮。
 * Firestore 單筆資料上限 1MB，所以壓到 base64 小於約 900KB；通常結果約 150～350KB。
 */
export function compressReceipt(img) {
  let long = 1600, q = 0.72;
  for (let i = 0; i < 8; i++) {
    const scale = Math.min(1, long / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < 900_000) return url;
    if (q > 0.5) q -= 0.1; else long = Math.round(long * 0.8);
  }
  throw new Error('照片太大，無法壓縮');
}

/** OCR 前處理：放大到適合辨識的大小、轉灰階、拉高對比 */
export function prepareForOcr(img) {
  const target = 1800;
  const scale = Math.min(2.5, target / Math.max(img.naturalWidth, img.naturalHeight) * 1.15);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const p = d.data;
  // 灰階 + 自動對比（取 2%～98% 亮度範圍拉伸）
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) {
    const g = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
    p[i] = g; hist[g]++;
  }
  const n = p.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) {
    let g = ((p[i] - lo) * 255) / range;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
