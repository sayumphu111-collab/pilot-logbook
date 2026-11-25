// backend.js — ชั้นเก็บข้อมูล: Firebase (sync ข้ามเครื่อง) หรือ "โหมดในเครื่อง" ถ้ายังไม่ได้ตั้งค่า Firebase
import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;

export const firebaseReady = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR');

const stamp = () => Date.now();
const stripUndefined = (o) => JSON.parse(JSON.stringify(o));
const safeDocId = (v, fallback = 'doc') => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || fallback;

// P0-2: สถานะซิงค์ต้องมาจาก "snapshot ปัจจุบัน" ไม่ใช่ flag ที่เคยเจอ server แล้วค้างไว้
export const SYNC_STREAMS = ['flights', 'config', 'opening', 'quarantine'];
export function computeSyncStatus(streams, pendingOps = 0) {
  const list = Array.isArray(streams) ? streams : SYNC_STREAMS.map((k) => streams?.[k]);
  const pending = pendingOps > 0 || list.some((s) => s?.pending === true);
  const allServer = list.length > 0 && list.every((s) => s && s.fromCache === false);
  return pending ? 'pending' : allServer ? 'synced' : 'offline';
}

// ---------------------------------------------------------------- โหมดในเครื่อง
function createLocalBackend() {
  const KEY = 'pilot-logbook.local.v1';
  let db = { flights: {}, opening: null, config: null, quarantine: {} };
  try { db = { ...db, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ว่าง */ }
  if (!db.quarantine || typeof db.quarantine !== 'object') db.quarantine = {};
  let cb = null;

  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { cb?.onError?.('พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม — ไม่สามารถยืนยันการบันทึกได้'); throw e; }
    emit();
  };
  const emit = () => {
    cb?.onFlights(Object.values(db.flights));
    cb?.onOpening(db.opening);
    cb?.onConfig(db.config);
    cb?.onQuarantine?.(Object.values(db.quarantine));
    cb?.onStatus?.('local');
  };

  return {
    mode: 'local',
    start(callbacks) { cb = callbacks; cb.onUser({ local: true }); emit(); cb.onSynced?.(); },
    signIn() {}, signOut() {},
    saveFlight(f) { db.flights[f.id] = stripUndefined(f); persist(); return Promise.resolve(); },
    saveMany(list) { for (const f of list) db.flights[f.id] = stripUndefined(f); persist(); return Promise.resolve(); },
    deleteFlight(id) { delete db.flights[id]; persist(); return Promise.resolve(); },
    saveOpening(o) { db.opening = o; persist(); return Promise.resolve(); },
    saveConfig(c) { db.config = c; persist(); return Promise.resolve(); },
    // P0-3: เก็บ flight ที่อ่านไม่ได้ไว้ตรวจซ่อม แทนที่จะตัดทิ้งเงียบ ๆ
    saveQuarantine(list) {
      (list || []).forEach((q, i) => { db.quarantine[safeDocId(q?.id, `unreadable_${i + 1}`)] = stripUndefined(q); });
      persist();
      return Promise.resolve();
    },
    // P0-5: คืน Promise และลบทุกชุดข้อมูล รวม quarantine
    deleteAll() { db = { flights: {}, opening: null, config: null, quarantine: {} }; persist(); return Promise.resolve(); },
  };
}

// ---------------------------------------------------------------- Firebase
async function createFirebaseBackend() {
  const [app, auth, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);

  const fbApp = app.initializeApp(firebaseConfig);
  const fbAuth = auth.getAuth(fbApp);
  // เก็บแคชใน IndexedDB → กรอกตอนออฟไลน์ได้ และซิงค์เองเมื่อมีเน็ต
  const db = fs.initializeFirestore(fbApp, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });

  let cb = null;
  let uid = null;
  let unsubs = [];

  const flightsCol = () => fs.collection(db, 'users', uid, 'flights');
  const quarantineCol = () => fs.collection(db, 'users', uid, 'quarantine');
  const openingDoc = () => fs.doc(db, 'users', uid, 'meta', 'opening');
  const configDoc = () => fs.doc(db, 'users', uid, 'meta', 'config');

  // P0-2: เก็บสถานะ "ล่าสุด" ของแต่ละ stream + จำนวน write ที่ยังไม่ขึ้น server
  const streams = Object.fromEntries(SYNC_STREAMS.map((k) => [k, { fromCache: null, pending: false }]));
  let pendingOps = 0;
  let notified = false;
  let lastError = null;

  const resetSyncState = () => {
    for (const s of Object.values(streams)) { s.fromCache = null; s.pending = false; }
    pendingOps = 0;
    notified = false;
    lastError = null;
  };
  const checkSynced = () => {
    // P2-0: ถ้าเคยเจอ error ให้ค้างสถานะ "ผิดพลาด" จนกว่า snapshot จาก server จะสำเร็จ
    if (lastError) { cb?.onStatus?.('error'); return; }
    const status = computeSyncStatus(streams, pendingOps);
    cb?.onStatus?.(status);
    if (status === 'synced' && !notified) { notified = true; cb.onSynced?.(); }
  };
  // setDoc/deleteDoc ของ Firestore resolve หลัง server ack → ใช้กันเคส delete ที่ hasPendingWrites ไม่ชัด
  const withPending = (p) => {
    pendingOps += 1;
    checkSynced();
    return Promise.resolve(p).finally(() => {
      pendingOps = Math.max(0, pendingOps - 1);
      checkSynced();
    });
  };

  const friendly = (e) => {
    const code = e?.code || '';
    if (code === 'permission-denied') return 'ไม่มีสิทธิ์บันทึกข้อมูล — ลองออกจากระบบแล้วเข้าใหม่ หรือตรวจว่า Publish กฎ Firestore แล้ว (ดู README)';
    if (code === 'unavailable') return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ข้อมูลเก็บไว้ในเครื่องและจะซิงค์เมื่อมีเน็ต';
    if (code === 'resource-exhausted') return 'โควตาฟรีของวันนี้เต็ม ข้อมูลจะซิงค์ได้อีกครั้งในวันถัดไป';
    return e?.message || String(e);
  };
  const fail = (e) => {
    lastError = friendly(e);
    cb?.onError?.(lastError);
    cb?.onStatus?.('error');
  };

  function listen() {
    unsubs.forEach((u) => u());
    unsubs = [];
    resetSyncState();
    checkSynced(); // ยังไม่มี snapshot → offline ทันที แม้เคย synced มาก่อน

    const handlers = {
      flights: (snap) => cb.onFlights(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      config: (snap) => {
        let c = null;
        try { c = snap.exists() ? JSON.parse(snap.data().json) : null; } catch { /* ข้าม */ }
        cb.onConfig(c);
      },
      opening: (snap) => {
        let o = null;
        try { o = snap.exists() ? JSON.parse(snap.data().json) : null; } catch { /* ข้าม */ }
        cb.onOpening(o);
      },
      quarantine: (snap) => cb.onQuarantine?.(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    };

    const watch = (key, ref, onValue) => {
      unsubs.push(fs.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        lastError = null;
        onValue(snap);
        streams[key].fromCache = snap.metadata.fromCache;
        streams[key].pending = snap.metadata.hasPendingWrites;
        checkSynced();
      }, fail));
    };

    watch('flights', flightsCol(), handlers.flights);
    watch('config', configDoc(), handlers.config);
    watch('opening', openingDoc(), handlers.opening);
    watch('quarantine', quarantineCol(), handlers.quarantine);

    // P2-0: บังคับอ่านจาก server ครั้งหนึ่งตอนเปิดแอป/เปลี่ยนผู้ใช้
    // กันเคสแคชในเบราว์เซอร์หรือ Service Worker ยังเสิร์ฟข้อมูลเก่า (doc มีอยู่บน server แต่แอปไม่โชว์)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    Promise.all([
      fs.getDocsFromServer(flightsCol()),
      fs.getDocFromServer(configDoc()),
      fs.getDocFromServer(openingDoc()),
      fs.getDocsFromServer(quarantineCol()),
    ]).then(([a, b, c, d]) => {
      lastError = null;
      handlers.flights(a);
      handlers.config(b);
      handlers.opening(c);
      handlers.quarantine(d);
      checkSynced();
    }).catch(fail);
  }

  return {
    mode: 'firebase',
    start(callbacks) {
      cb = callbacks;
      auth.onAuthStateChanged(fbAuth, (user) => {
        unsubs.forEach((u) => u());
        unsubs = [];
        uid = user?.uid || null;
        cb.onUser(user ? { email: user.email, name: user.displayName } : null);
        if (user) listen();
        else {
          cb.onFlights([]); cb.onOpening(null); cb.onConfig(null); cb.onQuarantine?.([]);
          resetSyncState(); checkSynced();
        }
      });
    },
    async signIn() {
      try { await auth.signInWithPopup(fbAuth, new auth.GoogleAuthProvider()); }
      catch (e) {
        if (e.code === 'auth/unauthorized-domain') fail('โดเมนนี้ยังไม่ได้เพิ่มใน Firebase → Authentication → Settings → Authorized domains');
        else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') fail(e.message);
      }
    },
    signOut() { return auth.signOut(fbAuth); },
    saveFlight(f) {
      return withPending(fs.setDoc(fs.doc(db, 'users', uid, 'flights', f.id), { ...stripUndefined(f), updatedAt: stamp() }).catch((e) => { fail(e); throw e; }));
    },
    saveMany(list) {
      const writes = [];
      for (let i = 0; i < list.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const f of list.slice(i, i + 400)) {
          batch.set(fs.doc(db, 'users', uid, 'flights', f.id), { ...stripUndefined(f), updatedAt: stamp() });
        }
        writes.push(withPending(batch.commit().catch((e) => { fail(e); throw e; })));
      }
      return Promise.all(writes);
    },
    deleteFlight(id) { return withPending(fs.deleteDoc(fs.doc(db, 'users', uid, 'flights', id)).catch((e) => { fail(e); throw e; })); },
    saveOpening(o) { return withPending(fs.setDoc(openingDoc(), { json: JSON.stringify(o), updatedAt: stamp() }).catch((e) => { fail(e); throw e; })); },
    saveConfig(c) { return withPending(fs.setDoc(configDoc(), { json: JSON.stringify(c), updatedAt: stamp() }).catch((e) => { fail(e); throw e; })); },
    // P0-3: flight ที่อ่านไม่ได้ถูกเก็บแยก เพื่อไม่ให้หายและยังตรวจซ่อมได้
    saveQuarantine(list) {
      const writes = [];
      const items = list || [];
      for (let i = 0; i < items.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const q of items.slice(i, i + 400)) {
          const id = safeDocId(q?.id, `unreadable_${i + 1}`);
          batch.set(fs.doc(db, 'users', uid, 'quarantine', id), { ...stripUndefined(q), updatedAt: stamp() });
        }
        writes.push(withPending(batch.commit().catch((e) => { fail(e); throw e; })));
      }
      return Promise.all(writes);
    },
    // P0-5: รอทุก batch ให้สำเร็จจริงก่อนคืน Promise + ลบ quarantine ด้วย
    async deleteAll(ids) {
      const ops = [];
      const chunks = (arr, size, fn) => {
        for (let i = 0; i < arr.length; i += size) fn(arr.slice(i, i + size));
      };

      chunks(ids || [], 400, (part) => {
        const batch = fs.writeBatch(db);
        for (const id of part) batch.delete(fs.doc(db, 'users', uid, 'flights', id));
        ops.push(withPending(batch.commit().catch((e) => { fail(e); throw e; })));
      });

      let qDocs = [];
      try { qDocs = (await fs.getDocs(quarantineCol())).docs; }
      catch (e) { fail(e); throw e; }
      chunks(qDocs, 400, (part) => {
        const batch = fs.writeBatch(db);
        for (const d of part) batch.delete(d.ref);
        ops.push(withPending(batch.commit().catch((e) => { fail(e); throw e; })));
      });

      ops.push(withPending(fs.deleteDoc(openingDoc()).catch((e) => { fail(e); throw e; })));
      ops.push(withPending(fs.deleteDoc(configDoc()).catch((e) => { fail(e); throw e; })));
      await Promise.all(ops);
    },
  };
}

export async function createBackend() {
  return firebaseReady ? createFirebaseBackend() : createLocalBackend();
}
