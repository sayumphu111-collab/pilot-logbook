// Service worker: เปิดแอปได้ตอนออฟไลน์ (แคชไฟล์แอป + ไลบรารีจาก CDN)
const CACHE = 'pilot-logbook-v8';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'xlsxfill.js', 'backend.js', 'firebase-config.js', 'manifest.webmanifest', 'template.xlsx', 'icons/icon-192.png'];
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// stale-while-revalidate: ใช้ของในแคชก่อน แล้วอัปเดตเบื้องหลัง
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !CDN_HOSTS.includes(url.hostname)) return; // Firestore/Auth ไม่ผ่านแคช
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
