// backend.js — ชั้นเก็บข้อมูล: Firebase (sync ข้ามเครื่อง) หรือ "โหมดในเครื่อง" ถ้ายังไม่ได้ตั้งค่า Firebase
import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;

export const firebaseReady = !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR');

const stamp = () => Date.now();
const stripUndefined = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- โหมดในเครื่อง
function createLocalBackend() {
  const KEY = 'pilot-logbook.local.v1';
  let db = { flights: {}, opening: null, config: null };
  try { db = { ...db, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ว่าง */ }
  let cb = null;

  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { cb?.onError?.('พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม'); }
    emit();
  };
  const emit = () => {
    cb?.onFlights(Object.values(db.flights));
    cb?.onOpening(db.opening);
    cb?.onConfig(db.config);
    cb?.onStatus('local');
  };

  return {
    mode: 'local',
    start(callbacks) { cb = callbacks; cb.onUser({ local: true }); emit(); cb.onSynced?.(); },
    signIn() {}, signOut() {},
    saveFlight(f) { db.flights[f.id] = stripUndefined(f); persist(); },
    saveMany(list) { for (const f of list) db.flights[f.id] = stripUndefined(f); persist(); },
    deleteFlight(id) { delete db.flights[id]; persist(); },
    saveOpening(o) { db.opening = o; persist(); },
    saveConfig(c) { db.config = c; persist(); },
    deleteAll() { db = { flights: {}, opening: null, config: null }; persist(); },
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
  const openingDoc = () => fs.doc(db, 'users', uid, 'meta', 'opening');
  const configDoc = () => fs.doc(db, 'users', uid, 'meta', 'config');
  let serverFlights = false;
  let serverConfig = false;
  let notified = false;
  // แจ้งว่าได้ข้อมูลล่าสุดจากเซิร์ฟเวอร์แล้ว (ไม่ใช่แค่แคชว่างๆ) — ใช้ตัดสินว่าผู้ใช้ใหม่จริงหรือไม่
  const checkSynced = () => { if (serverFlights && serverConfig && !notified) { notified = true; cb.onSynced?.(); } };
  const friendly = (e) => {
    const code = e?.code || '';
    if (code === 'permission-denied') return 'ไม่มีสิทธิ์บันทึกข้อมูล — ลองออกจากระบบแล้วเข้าใหม่ หรือตรวจว่า Publish กฎ Firestore แล้ว (ดู README)';
    if (code === 'unavailable') return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ข้อมูลเก็บไว้ในเครื่องและจะซิงค์เมื่อมีเน็ต';
    if (code === 'resource-exhausted') return 'โควตาฟรีของวันนี้เต็ม ข้อมูลจะซิงค์ได้อีกครั้งในวันถัดไป';
    return e?.message || String(e);
  };
  const fail = (e) => cb?.onError?.(friendly(e));

  function listen() {
    unsubs.forEach((u) => u());
    unsubs = [];
    serverFlights = false; serverConfig = false; notified = false;
    unsubs.push(fs.onSnapshot(flightsCol(), { includeMetadataChanges: true }, (snap) => {
      cb.onFlights(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      cb.onStatus(snap.metadata.hasPendingWrites ? 'pending' : snap.metadata.fromCache ? 'offline' : 'synced');
      if (!snap.metadata.fromCache) { serverFlights = true; checkSynced(); }
    }, fail));
    unsubs.push(fs.onSnapshot(configDoc(), { includeMetadataChanges: true }, (snap) => {
      let c = null;
      try { c = snap.exists() ? JSON.parse(snap.data().json) : null; } catch { /* ข้าม */ }
      cb.onConfig(c);
      if (!snap.metadata.fromCache) { serverConfig = true; checkSynced(); }
    }, fail));
    unsubs.push(fs.onSnapshot(openingDoc(), (snap) => {
      let o = null;
      try { o = snap.exists() ? JSON.parse(snap.data().json) : null; } catch { /* ข้าม */ }
      cb.onOpening(o);
    }, fail));
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
        else { cb.onFlights([]); cb.onOpening(null); cb.onConfig(null); }
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
      fs.setDoc(fs.doc(db, 'users', uid, 'flights', f.id), { ...stripUndefined(f), updatedAt: stamp() }).catch(fail);
    },
    saveMany(list) {
      for (let i = 0; i < list.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const f of list.slice(i, i + 400)) {
          batch.set(fs.doc(db, 'users', uid, 'flights', f.id), { ...stripUndefined(f), updatedAt: stamp() });
        }
        batch.commit().catch(fail);
      }
    },
    deleteFlight(id) { fs.deleteDoc(fs.doc(db, 'users', uid, 'flights', id)).catch(fail); },
    saveOpening(o) { fs.setDoc(openingDoc(), { json: JSON.stringify(o), updatedAt: stamp() }).catch(fail); },
    saveConfig(c) { fs.setDoc(configDoc(), { json: JSON.stringify(c), updatedAt: stamp() }).catch(fail); },
    // ลบข้อมูลทั้งหมดของผู้ใช้คนนี้ (เที่ยวบิน ยอดยกมา การตั้งค่า)
    deleteAll(ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const id of ids.slice(i, i + 400)) batch.delete(fs.doc(db, 'users', uid, 'flights', id));
        batch.commit().catch(fail);
      }
      fs.deleteDoc(openingDoc()).catch(fail);
      fs.deleteDoc(configDoc()).catch(fail);
    },
  };
}

export async function createBackend() {
  return firebaseReady ? createFirebaseBackend() : createLocalBackend();
}
