// The local engine (v0.40 phase 3): the server engine running on SQLite WASM in a Worker, fed with the signed-in person's saved state.
// Online-first for now: the server stays the source of truth. Reads are answered here (instant, same results);
// every write still goes to the server first and is then replayed here. If anything looks off, the engine drops
// itself and the app keeps working through the server exactly as before. Kill switch: localStorage tt.engine = "off", or ?engine=off.
const READS = /^\/api\/(overview|tickets\/[^/]+|tickets\/[^/]+\/extras|extras|steps\/\d+\/versions|search|drift|achievements|views|plan)$/;
const REPLAYS = /^\/api\/(steps\/\d+(\/done|\/note|\/reset|\/upstream)?|tickets\/[^/]+\/(note|status|extras)|bulk|bulk\/undo|views|plan|plan\/manual|resume|drift\/\d+)$/;
import { kv } from './store.js';
const MAX_STARTS = 3; // per page load, so a broken engine cannot loop

let state = 'idle'; // idle | loading | ready | off
let worker = null, starts = 0, writeSeq = 0, nextId = 0, tokenProvider = null, userId = null, source = null, startP = null, snapTimer = null;
const pending = new Map();
const off = () => { try { return localStorage.getItem('tt.engine') === 'off' || /[?&]engine=off\b/.test(location.search); } catch { return false; } };

function post(msg) {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('engine stopped'));
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}
function stop(next = 'idle') {
  try { worker?.terminate(); } catch {}
  worker = null; state = next;
  for (const p of pending.values()) p.reject(new Error('engine stopped'));
  pending.clear();
}

const key = () => 'state:' + userId;
// Where the saved state comes from: the server (normal), or this device's copy when the server cannot be reached.
async function loadState() {
  let net = null;
  try {
    const t = await tokenProvider();
    if (!t) throw new Error('no session');
    const r = await fetch('/api/state', { headers: { authorization: `Bearer ${t}` } });
    if (r.ok) { const saved = await r.json(); source = 'server'; if (userId) kv.set(key(), { saved, at: Date.now() }); return saved; }
    if (r.status === 401 || r.status === 403) { if (userId) kv.del(key()); throw new Error('state ' + r.status); } // not allowed: no device copy either
    net = new Error('state ' + r.status); // 5xx (for example the database is paused): the device copy may be used
  } catch (e) { if (e.message && /^state 40[13]$/.test(e.message)) throw e; net = e; }
  const copy = userId ? await kv.get(key()) : undefined;
  if (!copy?.saved) throw net;
  source = 'device';
  return copy.saved;
}

function start() {
  if (startP) return startP;
  return (startP = run1().finally(() => { startP = null; }));
}
async function run1() {
  if (state !== 'idle' || !tokenProvider || off() || typeof Worker === 'undefined') { if (off()) state = 'off'; return; }
  if (starts >= MAX_STARTS) { state = 'off'; return; }
  starts++; state = 'loading'; source = null;
  const seq = writeSeq;
  try {
    const saved = await loadState();
    const w = new Worker('/engine/worker.js', { type: 'module' });
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(Object.assign(new Error(e.data.error), { status: e.data.status })); } };
    w.onerror = () => stop('idle');
    worker = w;
    await post({ type: 'init', state: saved, contentUrl: '/engine/content.db', wasmUrl: '/engine/sqlite3.wasm', version: 'web' });
    if (seq !== writeSeq) { stop('idle'); return run1(); } // something was saved while loading: the loaded copy is stale
    state = 'ready';
  } catch { stop('idle'); state = starts >= MAX_STARTS ? 'off' : 'idle'; }
}

// After writes, refresh the device copy a little later (one fetch, however many writes), so an offline start is not far behind.
function snapshotSoon() {
  if (!userId || off()) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(async () => {
    try { const t = await tokenProvider(); if (!t) return; const r = await fetch('/api/state', { headers: { authorization: `Bearer ${t}` } }); if (r.ok) kv.set(key(), { saved: await r.json(), at: Date.now() }); } catch {}
  }, 2500);
}

export const engine = {
  /** Called once the person is signed in (hosted mode). Starts loading in the background; the app does not wait. */
  attach(provider, uid) { tokenProvider = provider; userId = uid || null; return start(); }, // resolves when the first start attempt is over
  status: () => state,
  /** Resolves when the current start attempt is over (immediately if none is running). */
  settled: () => startP || Promise.resolve(),
  /** 'server' | 'device' (started from this device's copy: you are offline or the server is down) | null */
  source: () => source,
  /** Answer a GET locally, or return undefined when the server should answer. */
  async read(url) {
    if (state !== 'ready') return undefined;
    const u = new URL(url, location.origin);
    if (!READS.test(u.pathname)) return undefined;
    try { return (await post({ type: 'call', method: 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams) })).result; }
    catch { return undefined; } // any doubt: the server answers
  },
  /** After a write succeeded on the server: apply it here too, or reload from the server if it cannot be applied. */
  wrote(method, url, body) {
    writeSeq++; snapshotSoon();
    if (state === 'off' || state === 'idle') return;
    if (state === 'loading') return; // the loading copy notices writeSeq and restarts
    const u = new URL(url, location.origin);
    if (!REPLAYS.test(u.pathname)) return this.invalidate();
    post({ type: 'call', method, path: u.pathname, query: Object.fromEntries(u.searchParams), body }).catch(() => this.invalidate());
  },
  /** Throw the local copy away; it reloads from the server in the background. */
  invalidate() { if (state === 'off') return; stop('idle'); start(); },
  /** Sign-out: forget everything on this device. */
  async wipe() { clearTimeout(snapTimer); stop('off'); await kv.clear(); },
};
if (typeof window !== 'undefined') {
  window.__ttEngine = engine;
  // back online after starting from the device copy: reload from the server so both agree
  window.addEventListener('online', () => { if (source === 'device') { starts = 0; engine.invalidate(); } });
}
