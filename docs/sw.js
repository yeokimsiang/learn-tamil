/* Offline cache. App files are served from the cache straight away and refreshed in the
   background, so a weak bus signal never leaves a blank screen. Pictures are cache-first. */
const CACHE = 'tamil-v3';
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
      for (const u of e.data.urls) { if (!(await c.match(u))) { try { await c.add(u); } catch (_) { /* missing picture */ } } }
    });
  }
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request, { ignoreSearch: true });
    const refresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
    if (url.pathname.includes('/img/')) return hit || refresh;
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; } // stale-while-revalidate
    try { return await refresh; } catch (err) { return (await c.match('index.html')) || Response.error(); }
  })());
});
