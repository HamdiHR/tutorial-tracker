// The local engine (v0.40 phase 3): the server engine running on SQLite WASM in a Worker, fed with the signed-in person's saved state.
// Online-first for now: the server stays the source of truth. Reads are answered here (instant, same results);
// every write still goes to the server first and is then replayed here. If anything looks off, the engine drops
// itself and the app keeps working through the server exactly as before. Kill switch: localStorage tt.engine = "off", or ?engine=off.
const READS = /^\/api\/(overview|tickets\/[^/]+|tickets\/[^/]+\/extras|extras|steps\/\d+\/versions|search|drift|achievements|views|plan)$/;
const REPLAYS = /^\/api\/(steps\/\d+(\/done|\/note|\/reset|\/upstream)?|tickets\/[^/]+\/(note|status|extras)|bulk|bulk\/undo|views|plan|plan\/manual|resume|drift\/\d+)$/;
const MAX_STARTS = 3; // per page load, so a broken engine cannot loop

let state = 'idle'; // idle | loading | ready | off
let worker = null, starts = 0, writeSeq = 0, nextId = 0, tokenProvider = null;
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

async function start() {
  if (state !== 'idle' || !tokenProvider || off() || typeof Worker === 'undefined') { if (off()) state = 'off'; return; }
  if (starts >= MAX_STARTS) { state = 'off'; return; }
  starts++; state = 'loading';
  const seq = writeSeq;
  try {
    const t = await tokenProvider();
    if (!t) throw new Error('no session');
    const r = await fetch('/api/state', { headers: { authorization: `Bearer ${t}` } });
    if (!r.ok) throw new Error('state ' + r.status);
    const saved = await r.json();
    const w = new Worker('/engine/worker.js', { type: 'module' });
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(Object.assign(new Error(e.data.error), { status: e.data.status })); } };
    w.onerror = () => stop('idle');
    worker = w;
    await post({ type: 'init', state: saved, contentUrl: '/engine/content.db', wasmUrl: '/engine/sqlite3.wasm', version: 'web' });
    if (seq !== writeSeq) { stop('idle'); return start(); } // something was saved while loading: the loaded copy is stale
    state = 'ready';
  } catch { stop('idle'); state = starts >= MAX_STARTS ? 'off' : 'idle'; }
}

export const engine = {
  /** Called once the person is signed in (hosted mode). Starts loading in the background; the app does not wait. */
  attach(provider) { tokenProvider = provider; start(); },
  status: () => state,
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
    writeSeq++;
    if (state === 'off' || state === 'idle') return;
    if (state === 'loading') return; // the loading copy notices writeSeq and restarts
    const u = new URL(url, location.origin);
    if (!REPLAYS.test(u.pathname)) return this.invalidate();
    post({ type: 'call', method, path: u.pathname, query: Object.fromEntries(u.searchParams), body }).catch(() => this.invalidate());
  },
  /** Throw the local copy away; it reloads from the server in the background. */
  invalidate() { if (state === 'off') return; stop('idle'); start(); },
};
if (typeof window !== 'undefined') window.__ttEngine = engine;
