const V = 'mz-b53456c-2026-09-22';
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
  // pages and code are fetched fresh when the network is there (a deploy must show on the first
  // relaunch, not the second); pictures and fonts stay cache-first
  if (req.mode === 'navigate' || /[.](html|js|mjs|json|webmanifest)$/i.test(url.pathname)) {
    // only the app itself is the shell: an iframe load (the map, a calculator, the PDF viewer) is a
    // navigation request too, and it used to be stored under - and, offline, answered with - the shell
    const key = (req.mode === 'navigate' && req.destination === 'document') ? './index.html' : req;
    e.respondWith(fetch(req).then((r) => { if (r && r.ok) { const c = r.clone(); caches.open(V).then((k) => k.put(key, c)); } return r; })
      .catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r && r.ok && r.type === 'basic') { const c = r.clone(); caches.open(V).then((k) => k.put(req, c)); }
    return r;
  })));
});
