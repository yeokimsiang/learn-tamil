/* Offline cache: app shell precached; sketches warmed after first load. */
const CACHE = 'tamil-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data/lesson1.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'warm') {
    caches.open(CACHE).then(async c => {
      for (const u of e.data.urls) { if (!(await c.match(u))) { try { await c.add(u); } catch (_) { /* missing image */ } } }
    });
  }
});
// Network first for code and data (so updates arrive), cache first for images.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isImg = url.pathname.includes('/img/');
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (isImg) {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      return (await c.match(e.request, { ignoreSearch: true })) || (await c.match('index.html'));
    }
  })());
});
