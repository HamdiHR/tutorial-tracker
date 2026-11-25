// Service worker (generated into public/sw.js by scripts/build.cjs). It keeps the app SHELL (page, scripts, styles,
// icons) available offline. It never touches /api/* and never caches data or signed file links: data handling is the
// app's job. Version = hash of the shell, so a new deployment installs a new worker, which waits until the person
// presses "Reload" in the app (no surprise reloads while editing).
const VERSION = '__VERSION__';
const CACHE = 'tt-shell-' + VERSION;
const SHELL = __PRECACHE__;
// The offline engine (worker, SQLite WASM, tutorial database: several MB) lives in its own cache, filled in the background,
// so a slow download can never stop the app shell from installing. Its version is a hash of those files.
const ENGINE_VERSION = '__ENGINE_VERSION__';
const ENGINE_CACHE = 'tt-engine-' + ENGINE_VERSION;
const ENGINE = __ENGINE__;
const fillEngine = async () => { if (!ENGINE.length) return; const c = await caches.open(ENGINE_CACHE); await Promise.allSettled(ENGINE.map(async (u) => { if (!(await c.match(u))) await c.add(new Request(u, { cache: 'reload' })); })); };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if ((k.startsWith('tt-shell-') && k !== CACHE) || (k.startsWith('tt-engine-') && k !== ENGINE_CACHE)) await caches.delete(k);
    await self.clients.claim();
    await fillEngine(); // background; the worker stays active until it is done
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'ENGINE_STATUS' && event.source) caches.open(ENGINE_CACHE).then((c) => Promise.all(ENGINE.map((u) => c.match(u)))).then((r) => event.source.postMessage({ type: 'ENGINE_STATUS', total: ENGINE.length, cached: r.filter(Boolean).length }));
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
  if (ENGINE.includes(url.pathname)) { event.respondWith(caches.open(ENGINE_CACHE).then((c) => c.match(url.pathname)).then((hit) => hit || fetch(req))); return; }
  if (SHELL.includes(url.pathname)) event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
