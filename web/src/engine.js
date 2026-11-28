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
let queue = null, failed = [], queueReady = Promise.resolve(), flushing = null, retryTimer = null; // the outbox: changes made here that the server has not confirmed yet
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
const okey = () => 'outbox:' + userId, fkey = () => 'failed:' + userId;
const notify = () => { try { window.dispatchEvent(new CustomEvent('tt-outbox', { detail: { pending: queue?.length || 0, failed: failed.length } })); } catch {} };
async function loadQueue() {
  if (!userId) { queue = []; failed = []; return; }
  queue = (await kv.get(okey())) || []; failed = (await kv.get(fkey())) || [];
  notify();
}
const saveQueue = () => kv.set(okey(), queue);
const REPLAY_PATH = (url) => REPLAYS.test(new URL(url, location.origin).pathname);
// Clock correction: every server answer tells us the server's time; the difference to this device's clock dates offline changes.
let clockOffset = 0;
try { clockOffset = Number(localStorage.getItem('tt.clock')) || 0; } catch {}
const noteServerTime = (r, sentAt) => {
  const st = Number(r?.headers?.get?.('x-server-time'));
  if (!Number.isFinite(st) || st <= 0) return;
  clockOffset = Math.round(st - (sentAt + Date.now()) / 2); // assume the answer took half the round trip
  try { localStorage.setItem('tt.clock', String(clockOffset)); } catch {}
};
const netErr = () => Object.assign(new Error('Cannot reach the server. Check your connection.'), { network: true });
/** Send one queued change to the server, with its operation id so a retry is never applied twice. */
async function send(op) {
  let t;
  try { t = await tokenProvider(); } catch { throw netErr(); }
  if (!t) throw netErr();
  let r; const sentAt = Date.now();
  try { r = await fetch(op.url, { method: op.method, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', 'x-op-id': op.id, 'x-op-time': String(op.ts) }, body: JSON.stringify(op.body ?? {}) }); } catch { throw netErr(); }
  noteServerTime(r, sentAt);
  if (r.ok) return;
  const data = await r.json().catch(() => ({}));
  throw Object.assign(new Error(data.error || `${r.status}`), { status: r.status });
}
/** Upload waiting changes, in order, one at a time. Stops at the first network/server problem and tries again later. */
function flush() {
  if (flushing) return flushing;
  return (flushing = (async () => {
    await queueReady;
    clearTimeout(retryTimer);
    let sent = 0, dropped = false;
    while (queue && queue.length) {
      const op = queue[0];
      try { await send(op); }
      catch (e) {
        if (e.network || !e.status || e.status >= 500 || e.status === 401 || e.status === 429) { retryTimer = setTimeout(flush, 30_000); break; } // try again later
        failed.push({ ...op, error: e.message, at: Date.now() }); dropped = true; await kv.set(fkey(), failed); // the server refused it for good: keep a record, never silently
      }
      queue.shift(); sent++; writeSeq++; await saveQueue(); notify();
    }
    if (sent) snapshotSoon();
    if (dropped) { starts = 0; stop('idle'); start(); } // the local copy no longer matches the server: reload from it
  })().finally(() => { flushing = null; }));
}
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
    await queueReady;
    const saved = await loadState();
    const w = new Worker('/engine/worker.js', { type: 'module' });
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(Object.assign(new Error(e.data.error), { status: e.data.status })); } };
    w.onerror = () => stop('idle');
    worker = w;
    await post({ type: 'init', state: saved, contentUrl: '/engine/content.db', wasmUrl: '/engine/sqlite3.wasm', version: 'web' });
    if (seq !== writeSeq) { stop('idle'); return run1(); } // something was saved while loading: the loaded copy is stale
    // rebase: the loaded copy does not know about changes still waiting to upload, so apply them on top (like git rebase)
    for (const op of queue || []) { const u = new URL(op.url, location.origin); try { await post({ type: 'call', method: op.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: op.body }); } catch {} }
    state = 'ready';
    if (queue?.length && navigator.onLine !== false) flush();
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
  attach(provider, uid) { tokenProvider = provider; userId = uid || null; queueReady = loadQueue(); return start(); }, // resolves when the first start attempt is over
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
  /** True when changes made on this device are still waiting to upload (new changes must line up behind them). */
  hasPending: () => !!queue?.length,
  pending: () => queue?.length || 0,
  failedCount: () => failed.length,
  /** Can a change be saved on this device while the server cannot be reached? */
  canQueue: (method, url) => state === 'ready' && !!userId && REPLAY_PATH(url),
  /** Save a change on this device and line it up for upload. Resolves with the same answer the server would give. */
  async enqueue(opId, method, url, body) {
    await queueReady;
    if (!this.canQueue(method, url)) throw netErr();
    const u = new URL(url, location.origin);
    const r = await post({ type: 'call', method, path: u.pathname, query: Object.fromEntries(u.searchParams), body }); // the local engine validates it like the server (a refusal throws here, nothing is queued)
    queue.push({ id: opId, method, url, body, ts: Date.now() + clockOffset }); // dated by the corrected clock
    await saveQueue(); notify();
    if (navigator.onLine !== false) flush();
    return r.result;
  },
  flush,
  noteServerTime,
  clockOffset: () => clockOffset,
  async clearFailed() { failed = []; await kv.del(fkey()); notify(); },
  /** Throw the local copy away; it reloads from the server in the background. */
  invalidate() { if (state === 'off') return; stop('idle'); start(); },
  /** Sign-out: forget everything on this device. */
  async wipe() { clearTimeout(snapTimer); clearTimeout(retryTimer); stop('off'); queue = []; failed = []; await kv.clear(); notify(); },
};
if (typeof window !== 'undefined') {
  window.__ttEngine = engine;
  // back online after starting from the device copy: reload from the server so both agree
  window.addEventListener('online', () => { flush().finally(() => { if (source === 'device') { starts = 0; engine.invalidate(); } }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && queue?.length && navigator.onLine !== false) flush(); });
}
