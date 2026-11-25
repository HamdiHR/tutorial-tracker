// Browser engine parity (v0.40 phase 3): the same scenario runs on the Node engine and on the SQLite-WASM engine in a Worker.
// Every response and every outbox diff must be identical (timestamps normalised: the two engines run at slightly different times).
const path = require('node:path');
const { chromium, ok, U, done } = require('./helpers.cjs');
const ROOT = path.resolve(__dirname, '../..');
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/(^|_)(ts|at)$/.test(k) || k === 'now' ? undefined : x)));
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

(async () => {
  const { openWorking, extract, diff } = await import(path.join(ROOT, 'hosted/state.js'));
  const { createApi } = await import(path.join(ROOT, 'server/api.js'));
  const w = openWorking(path.join(ROOT, 'hosted/content.db'));
  const api = createApi(w.db, { version: 't', hosted: true, dataDir: '', dbPath: '', contentDir: '', exportDir: '' });
  let before = extract(w.db);
  const node = (method, p, query = {}, body = {}) => {
    let result, error;
    try { result = api(method, p, new URLSearchParams(query), body); } catch (e) { error = { status: e.status || 500, error: e.message }; }
    let d = null;
    if (method !== 'GET') { const after = extract(w.db); d = diff(w.db, before, after); before = after; }
    return { result, diff: d, error };
  };
  const ids = w.db.prepare("SELECT id FROM steps WHERE kind IN ('step','verify') AND orphan=0 ORDER BY id").all().map((r) => r.id);
  const ticket = w.db.prepare('SELECT ticket_id t FROM steps WHERE id=?').get(ids[3]).t;
  const plan = { anchor: 'here', startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5, perSprint: {}, daysOff: [] };
  const scenario = [
    ['GET', '/api/overview'],
    ...ids.slice(0, 25).map((id) => ['POST', `/api/steps/${id}/done`, {}, { done: true }]),
    ['POST', `/api/steps/${ids[2]}/done`, {}, { done: false }],
    ['PUT', `/api/steps/${ids[30]}/note`, {}, { note: 'remember the docker network' }],
    ['PUT', `/api/tickets/${ticket}/note`, {}, { note: 'ticket note' }],
    ['PUT', `/api/tickets/${ticket}/status`, {}, { status: 'blocked' }],
    ['PUT', `/api/steps/${ids[40]}`, {}, { title: 'Edited title', body: 'Edited body with a 🔍 line' }],
    ['PUT', '/api/plan', { today: '2027-01-04' }, plan],
    ['GET', '/api/plan', { today: '2027-01-06' }],
    ['GET', '/api/search', { q: 'docker' }],
    ['GET', '/api/search', { q: 'remember' }],
    ['GET', '/api/achievements'],
    ['GET', '/api/overview'],
    ['POST', '/api/steps/99999999/done', {}, { done: true }], // error path must match too
  ];

  const b = await chromium.launch(); const errs = [];
  const page = await (await b.newContext()).newPage(); page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(U);
  const init = await page.evaluate(async (base) => {
    const w = new Worker(base + 'engine/worker.js', { type: 'module' }); window.__w = w; let n = 0; const pend = new Map();
    w.onmessage = (e) => { pend.get(e.data.id)?.(e.data); pend.delete(e.data.id); };
    window.__send = (m) => new Promise((r) => { const id = ++n; pend.set(id, r); w.postMessage({ ...m, id }); });
    return window.__send({ type: 'init', state: {}, contentUrl: base + 'engine/content.db', wasmUrl: base + 'engine/sqlite3.wasm', version: 't' });
  }, U);
  ok('worker engine starts', init.ok, init.ok ? JSON.stringify(init.timings) : init.error);

  let bad = 0, firstBad = '';
  for (const [method, p, query = {}, body = {}] of scenario) {
    const n = node(method, p, query, body);
    const r = await page.evaluate((m) => window.__send({ type: 'call', ...m }), { method, path: p, query, body });
    const good = n.error ? !r.ok && r.status === n.error.status : r.ok && same(r.result, n.result) && same(r.diff, n.diff);
    if (!good) { bad++; firstBad ||= `${method} ${p}`; }
  }
  ok(`all ${scenario.length} responses and outbox diffs match the Node engine`, bad === 0, firstBad);
  const x = await page.evaluate(() => window.__send({ type: 'extract' }));
  ok('worker state has the ticked steps', x.ok && x.counts.steps >= 25, JSON.stringify(x.counts));
  done(errs); await b.close(); w.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 500)); process.exit(1); });
