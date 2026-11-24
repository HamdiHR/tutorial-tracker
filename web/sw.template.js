// Service worker (generated into public/sw.js by scripts/build.cjs). It keeps the app SHELL (page, scripts, styles,
// icons) available offline. It never touches /api/* and never caches data or signed file links: data handling is the
// app's job. Version = hash of the shell, so a new deployment installs a new worker, which waits until the person
// presses "Reload" in the app (no surprise reloads while editing).
const VERSION = '__VERSION__';
const CACHE = 'tt-shell-' + VERSION;
const SHELL = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tt-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // data: always the network
  if (req.mode === 'navigate') {
    // every page load is the same single-page shell (routes live after the #)
    event.respondWith(caches.match('/index.html', { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
