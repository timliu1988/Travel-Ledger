// 資料層：有 Firebase 設定就用雲端同步，沒有就用本機模式。
// 兩種模式提供一樣的介面，app.js 不需要知道是哪一種。
//
// 資料結構
//   ledgers/{ledgerId}                  帳本：name, members[{id,name,avatar}], tripIds[]
//   trips/{tripId}                      旅程：ledgerId, name, currency, startDate, endDate, memberIds[],
//                                             estRate（刷卡預估匯率）, settleRate（結算匯率）, settleMode
//   trips/{tripId}/expenses/{id}        支出
//   trips/{tripId}/exchanges/{id}       換匯紀錄
//   trips/{tripId}/receipts/{key}       收據照片（需要時才讀取，避免每次同步都下載照片）
//
// 帳本代碼 = ledgerId；旅程不再需要各自的代碼，加入帳本就能看到裡面所有旅程。
// 用 * 匯入：舊版的 firebase-config.js 沒有 appCheckSiteKey 也不會出錯
import * as CFG from './firebase-config.js';
import { setFirebaseApp, setAppCheck } from './ai.js';

export const FIREBASE_VERSION = '12.19.0';

export function uid(n = 12) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((x) => a[x % a.length]).join('');
}

/** 一筆支出可以有多張收據：第 1 張用支出 id，第 2 張起加 _2、_3… */
export const receiptKey = (expenseId, i) => (i === 0 ? expenseId : `${expenseId}_${i + 1}`);

export async function createStore() {
  if (CFG.firebaseConfig && CFG.firebaseConfig.apiKey) return createFirebaseStore(CFG.firebaseConfig, CFG.appCheckSiteKey);
  return createLocalStore();
}

/** 本機模式模擬 Firestore 的「a.b」欄位路徑更新 */
function applyPatch(obj, patch) {
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {});
    o[parts.at(-1)] = v;
  }
}

/** 把多次變動合併成一次通知，避免畫面一直重畫 */
function batcher(fn, ms = 40) {
  let t = 0;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

/* ---------------- 本機收據：IndexedDB（照片太大，不適合放 localStorage） ---------------- */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tl_receipts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('r');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('r', mode);
    const req = fn(tx.objectStore('r'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/* ================= 本機模式 ================= */
function createLocalStore() {
  const KEY = 'tl_local_db_v4';
  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      return d && d.ledgers ? d : { ledgers: {}, trips: {} };
    } catch { return { ledgers: {}, trips: {} }; }
  };
  let db = load();
  const subs = new Set();
  const store = { mode: 'local', onError: null };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { store.onError?.(e); }
    subs.forEach((f) => f());
  };
  window.addEventListener('storage', (e) => { if (e.key === KEY) { db = load(); subs.forEach((f) => f()); } });
  const toList = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
  const snapLedger = (lid) => {
    const l = db.ledgers[lid];
    if (!l) return null;
    const ledger = { id: lid, ...structuredClone(l) };
    const trips = {};
    for (const tid of ledger.tripIds || []) {
      const t = db.trips[tid];
      if (!t) continue;
      const { expenses, exchanges, ...trip } = structuredClone(t);
      trips[tid] = { trip: { id: tid, ...trip }, expenses: toList(expenses), exchanges: toList(exchanges), loaded: true };
    }
    return { ledger, trips, pending: 0 };
  };

  Object.assign(store, {
    subscribeLedger(lid, cb) {
      const f = () => cb(snapLedger(lid));
      subs.add(f);
      queueMicrotask(f);
      return () => subs.delete(f);
    },
    createLedger(data, presetId) {
      const id = presetId || uid();
      db.ledgers[id] = { tripIds: [], ...data };
      save();
      return id;
    },
    updateLedger(id, patch) { applyPatch(db.ledgers[id], patch); save(); },
    async ledgerExists(id) { return !!db.ledgers[id]; },
    async getLedger(id) { const l = db.ledgers[id]; return l ? { id, ...structuredClone(l) } : null; },
    /** 旅程整趟搬到另一本帳本（資料、收據都不動，只換所屬帳本） */
    async moveTrip(tid, fromLid, toLid) {
      db.trips[tid].ledgerId = toLid;
      const to = db.ledgers[toLid];
      to.tripIds = [...new Set([...(to.tripIds || []), tid])];
      const from = db.ledgers[fromLid];
      if (from) from.tripIds = (from.tripIds || []).filter((x) => x !== tid);
      save();
    },
    async deleteLedger(id) {
      for (const tid of db.ledgers[id]?.tripIds || []) await store.deleteTrip(id, tid, true);
      delete db.ledgers[id];
      save();
    },
    createTrip(ledgerId, data) {
      const id = uid();
      db.trips[id] = { ...data, ledgerId, expenses: {}, exchanges: {} };
      const l = db.ledgers[ledgerId];
      l.tripIds = [...new Set([...(l.tripIds || []), id])];
      save();
      return id;
    },
    updateTrip(id, patch) { applyPatch(db.trips[id], patch); save(); },
    async deleteTrip(ledgerId, id, silent) {
      delete db.trips[id];
      const l = db.ledgers[ledgerId];
      if (l) l.tripIds = (l.tripIds || []).filter((x) => x !== id);
      if (!silent) save();
      await idbDo('readwrite', (s) => s.delete(IDBKeyRange.bound(id + '/', id + '/￿'))).catch(() => {});
    },
    addItem(tripId, coll, data, presetId) {
      const k = presetId || uid(16);
      db.trips[tripId][coll][k] = data;
      save();
      return k;
    },
    updateItem(tripId, coll, k, patch) { Object.assign(db.trips[tripId][coll][k], patch); save(); },
    deleteItem(tripId, coll, k) { delete db.trips[tripId][coll][k]; save(); },
    newId: () => uid(16),
    async saveReceipt(tripId, key, dataUrl) { await idbDo('readwrite', (s) => s.put(dataUrl, tripId + '/' + key)); },
    async getReceipt(tripId, key) { return (await idbDo('readonly', (s) => s.get(tripId + '/' + key))) || null; },
    async deleteReceipt(tripId, key) { await idbDo('readwrite', (s) => s.delete(tripId + '/' + key)); },
  });
  return store;
}

/* ================= Firebase 雲端同步 ================= */
async function createFirebaseStore(cfg, appCheckSiteKey) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [appMod, fs, authMod] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-firestore.js'),
    import(base + 'firebase-auth.js'),
  ]);
  const {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    doc, collection, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch,
    arrayUnion, arrayRemove,
  } = fs;

  const app = appMod.initializeApp(cfg);
  // App Check（選用）：確認連到資料庫和 Gemini 的是你網址上的這個 App，別人拿走設定碼也用不了
  let appCheck = false;
  if (appCheckSiteKey) {
    try {
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; // 在自己電腦測試用
      const ac = await import(base + 'firebase-app-check.js');
      // 傳統版 reCAPTCHA v3 已淘汰，改用 Fraud Defense（舊稱 reCAPTCHA Enterprise）
      const inst = ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
      setAppCheck({ inst, mod: ac });
      appCheck = true;
    } catch (e) { console.warn('App Check 啟用失敗', e); setAppCheck({ error: e }); }
  }
  setFirebaseApp(app);
  // 離線快取：沒網路也能記帳，連上網後自動同步
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  // 匿名登入（不需要帳號密碼，只是讓資料庫規則可以擋掉未經 App 的存取）
  const auth = authMod.getAuth(app);
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const unsub = authMod.onAuthStateChanged(auth, async (user) => {
      if (user) { unsub(); finish(); return; }
      try { await authMod.signInAnonymously(auth); } catch (e) { console.warn(e); finish(); }
    });
    setTimeout(finish, 8000);
  });

  const fail = (e) => { console.error(e); store.onError?.(e); };
  const docs = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));

  const store = {
    mode: 'firebase',
    appCheck,
    onError: null,

    /** 訂閱整本帳本：帳本本身 + 裡面每一趟旅程的支出與換匯 */
    subscribeLedger(lid, cb) {
      let ledger; // undefined = 還在讀
      const trips = {}; // tid -> { trip, expenses, exchanges, got, unsubs }
      const emit = batcher(() => {
        if (ledger === undefined) return;
        if (ledger === null) { cb(null); return; }
        const out = {};
        let pending = 0;
        for (const [tid, t] of Object.entries(trips)) {
          if (t.trip === undefined) { pending++; continue; } // 還在讀
          if (t.trip === null) continue; // 旅程已被刪除
          if (t.got !== 7) pending++;
          out[tid] = { trip: t.trip, expenses: t.expenses, exchanges: t.exchanges, loaded: t.got === 7 };
        }
        cb({ ledger, trips: out, pending });
      });
      const watchTrip = (tid) => {
        const t = { trip: undefined, expenses: [], exchanges: [], got: 0, unsubs: [] };
        trips[tid] = t;
        t.unsubs.push(onSnapshot(doc(db, 'trips', tid), (s) => {
          if (!s.exists() && s.metadata.fromCache) return;
          t.trip = s.exists() ? { id: s.id, ...s.data() } : null;
          t.got |= 1; emit();
        }, (e) => { fail(e); t.trip = null; t.got = 7; emit(); }));
        t.unsubs.push(onSnapshot(collection(db, 'trips', tid, 'expenses'), (s) => { t.expenses = docs(s); t.got |= 2; emit(); }, fail));
        t.unsubs.push(onSnapshot(collection(db, 'trips', tid, 'exchanges'), (s) => { t.exchanges = docs(s); t.got |= 4; emit(); }, fail));
      };
      const syncTrips = (ids) => {
        for (const tid of ids) if (!trips[tid]) watchTrip(tid);
        for (const tid of Object.keys(trips)) {
          if (!ids.includes(tid)) { trips[tid].unsubs.forEach((u) => u()); delete trips[tid]; }
        }
      };
      const u = onSnapshot(doc(db, 'ledgers', lid), (s) => {
        if (!s.exists() && s.metadata.fromCache) return; // 等伺服器回覆
        ledger = s.exists() ? { id: s.id, ...s.data() } : null;
        if (ledger) syncTrips(ledger.tripIds || []);
        emit();
      }, (e) => { fail(e); ledger = null; emit(); });
      return () => { u(); Object.values(trips).forEach((t) => t.unsubs.forEach((x) => x())); };
    },

    createLedger(data, presetId) {
      const id = presetId || uid();
      setDoc(doc(db, 'ledgers', id), { tripIds: [], ...data }).catch(fail);
      return id;
    },
    updateLedger(id, patch) { updateDoc(doc(db, 'ledgers', id), patch).catch(fail); },
    async ledgerExists(id) { return (await getDoc(doc(db, 'ledgers', id))).exists(); },
    async getLedger(id) { const s = await getDoc(doc(db, 'ledgers', id)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async moveTrip(tid, fromLid, toLid) {
      // 三個變動一起送出：要嘛全部成功、要嘛都不改
      const b = writeBatch(db);
      b.update(doc(db, 'trips', tid), { ledgerId: toLid });
      b.update(doc(db, 'ledgers', toLid), { tripIds: arrayUnion(tid) });
      b.update(doc(db, 'ledgers', fromLid), { tripIds: arrayRemove(tid) });
      await b.commit(); // 呼叫前已確認有網路（離線時這裡會一直等到連上線）
    },
    async deleteLedger(id) {
      const s = await getDoc(doc(db, 'ledgers', id));
      for (const tid of s.data()?.tripIds || []) await store.deleteTrip(id, tid, true);
      await deleteDoc(doc(db, 'ledgers', id));
    },

    createTrip(ledgerId, data) {
      const id = uid();
      setDoc(doc(db, 'trips', id), { ...data, ledgerId }).catch(fail);
      updateDoc(doc(db, 'ledgers', ledgerId), { tripIds: arrayUnion(id) }).catch(fail);
      return id;
    },
    updateTrip(id, patch) { updateDoc(doc(db, 'trips', id), patch).catch(fail); },
    async deleteTrip(ledgerId, id, skipLedger) {
      // Firestore 不會自動刪子集合，要逐筆刪
      for (const sub of ['expenses', 'exchanges', 'receipts']) {
        const snap = await getDocs(collection(db, 'trips', id, sub));
        for (let i = 0; i < snap.docs.length; i += 400) {
          const b = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      await deleteDoc(doc(db, 'trips', id));
      if (!skipLedger) await updateDoc(doc(db, 'ledgers', ledgerId), { tripIds: arrayRemove(id) });
    },

    newId: () => doc(collection(db, 'trips')).id,
    addItem(tripId, coll, data, presetId) {
      const ref = presetId ? doc(db, 'trips', tripId, coll, presetId) : doc(collection(db, 'trips', tripId, coll));
      setDoc(ref, data).catch(fail);
      return ref.id;
    },
    updateItem(tripId, coll, k, patch) { updateDoc(doc(db, 'trips', tripId, coll, k), patch).catch(fail); },
    deleteItem(tripId, coll, k) { deleteDoc(doc(db, 'trips', tripId, coll, k)).catch(fail); },

    async saveReceipt(tripId, key, dataUrl) {
      // 不等伺服器回覆（離線時會排隊，連線後上傳）
      setDoc(doc(db, 'trips', tripId, 'receipts', key), { data: dataUrl, updatedAt: Date.now() }).catch(fail);
    },
    async getReceipt(tripId, key) {
      const s = await getDoc(doc(db, 'trips', tripId, 'receipts', key));
      return s.exists() ? s.data().data : null;
    },
    async deleteReceipt(tripId, key) { deleteDoc(doc(db, 'trips', tripId, 'receipts', key)).catch(fail); },
  };
  return store;
}
