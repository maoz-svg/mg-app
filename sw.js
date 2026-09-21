const V = 'mz-86ba34f-2026-09-21';
const SHELL = ['./', './index.html', './manifest.webmanifest', './pwa/icon-192.png', './pwa/icon-512.png', './pwa/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mz-') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/[.](mp4|webm|mov)$/i.test(url.pathname) || req.headers.get('range')) return;   // stream, never store
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(V).then((k) => k.put('./index.html', c)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r && r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then((k) => k.put(req, c)); }
    return r;
  })));
});
