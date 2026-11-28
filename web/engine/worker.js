// Browser engine (v0.40 phase 3): the SAME server engine (server/api.js + hosted/state.js) running on SQLite WASM in a Worker.
// Protocol (postMessage, every request has an id):
//   {id, type:'init', state, contentUrl, wasmUrl, version}   -> {id, ok, timings}      load content.db, hydrate the person's state
//   {id, type:'call', method, path, query, body}             -> {id, ok, status, result, diff}
//        diff = what changed (hosted/state.js diff format, null if nothing): this is what the outbox will store for sync.
//   {id, type:'extract'}                                     -> {id, ok, counts}      debugging
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from './shims/node-sqlite.js';
import { createApi } from '../../server/api.js';
import { hydrate, extract, diff, baseOf } from '../../hosted/state.js';

const now = () => performance.now();
let db = null, api = null, before = null;

async function init({ state, contentUrl, wasmUrl, version }) {
  const t = {}; let t0 = now();
  const sqlite3 = await sqlite3InitModule({ locateFile: (f) => (f.endsWith('.wasm') ? wasmUrl : f) }); t.wasm = now() - t0; t0 = now();
  const bytes = new Uint8Array(await (await fetch(contentUrl)).arrayBuffer()); t.fetch = now() - t0; t0 = now();
  const odb = new sqlite3.oo1.DB(':memory:');
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  odb.checkRc(sqlite3.capi.sqlite3_deserialize(odb.pointer, 'main', p, bytes.length, bytes.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE));
  db = wrapDb(sqlite3, odb); t.load = now() - t0; t0 = now();
  hydrate(db, state || {}); t.hydrate = now() - t0; t0 = now();
  api = createApi(db, { version: version || 'dev', hosted: true, dataDir: '', dbPath: '', contentDir: '', exportDir: '' });
  before = extract(db); t.extract = now() - t0;
  return { timings: t };
}

function call({ method, path, query, body }) {
  const q = new URLSearchParams(query || {});
  const result = api(method, path, q, body || {});
  let d = null;
  let base = null;
  if (method !== 'GET' && method !== 'HEAD') { const after = extract(db); d = diff(db, before, after); base = baseOf(before, d); before = after; }
  return { status: 200, result, diff: d, base };
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') self.postMessage({ id, ok: true, ...(await init(e.data)) });
    else if (!api) throw Object.assign(new Error('engine not initialised'), { status: 503 });
    else if (type === 'call') self.postMessage({ id, ok: true, ...call(e.data) });
    else if (type === 'extract') { const x = extract(db); self.postMessage({ id, ok: true, counts: { steps: x.steps.size, tickets: x.tickets.size, meta: x.meta.size, badges: x.badges.size } }); }
    else throw new Error('unknown message ' + type);
  } catch (err) { self.postMessage({ id, ok: false, status: err.status || 500, error: String(err.message || err) }); }
};
