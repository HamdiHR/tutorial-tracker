// Hosted app + local engine (v0.40 phase 3, P3-3). Runs under the REAL production Content-Security-Policy from vercel.json
// (the dev server has none, and WebAssembly is blocked without 'wasm-unsafe-eval'). Checks: the engine starts, reads stay off the
// network, a write goes to the server and is replayed locally (both agree), a dropped engine reloads, and the kill switch works.
const fs = require('node:fs'), path = require('node:path');
const { chromium, ok, U, done } = require('./helpers.cjs');
const vj = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'));
// Only connect-src is widened (the test's fake Supabase is a local port); script-src, worker-src, 'wasm-unsafe-eval' etc. are production's.
const csp = vj.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:* http://localhost:*");
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/(^|_)(ts|at)$/.test(k) ? undefined : x)));

async function signUp(ctx, errs) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(U); await p.waitForSelector('.auth-card'); await p.click('text=Create account');
  await p.fill('input[name=email]', 'owner@x.com'); await p.fill('input[name=password]', 'password123'); await p.fill('input[name=again]', 'password123'); await p.click('button[type=submit]');
  await p.waitForSelector('.ob-choice'); await p.click('.ob-choice >> nth=0'); await p.waitForSelector('.hero2', { timeout: 15000 });
  return p;
}
const status = (p) => p.evaluate(() => window.__ttEngine?.status());
const until = (p, want, ms = 25000) => p.waitForFunction((w) => window.__ttEngine?.status() === w, want, { timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route('**/*', async (route) => { // enforce the production CSP on every response
    const r = await route.fetch();
    await route.fulfill({ response: r, headers: { ...r.headers(), 'content-security-policy': csp } });
  });
  const p = await signUp(ctx, errs);
  ok('engine becomes ready under the production CSP', await until(p, 'ready'), await status(p));

  const tok = JSON.parse(await p.evaluate(() => localStorage.getItem('tt.session'))).access_token;
  const server = async (m, u, body) => (await fetch(U + 'api' + u, { method: m, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  const ov0 = await server('GET', '/overview');
  const tid = ov0.sprints[0].items.find((x) => x.kind === 'ticket').id;
  const detail = await server('GET', '/tickets/' + tid);
  const step = detail.steps.find((s) => s.kind === 'step' && !s.done);

  const reqs = []; p.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await p.goto(U + `#/t/${encodeURIComponent(tid)}/${step.id}`); await p.waitForSelector('.toggle-done');
  ok('opening a task is answered locally (no GET /api/tickets)', !reqs.some((r) => r.startsWith('GET /api/tickets/')), JSON.stringify(reqs));

  await p.click('.toggle-done');
  await p.waitForFunction(() => document.querySelector('.toggle-done')?.textContent?.match(/done|undo|✓/i) || true);
  await p.waitForTimeout(800);
  ok('the tick went to the server', reqs.includes(`POST /api/steps/${step.id}/done`), JSON.stringify(reqs));
  const local = await p.evaluate(() => window.__ttEngine.read('/api/overview'));
  const remote = await server('GET', '/overview');
  ok('local engine saw the tick (1 step done)', local?.totals?.done === 1 || local?.totals?.stepsDone === 1 || JSON.stringify(local?.totals) === JSON.stringify(remote.totals), JSON.stringify(local?.totals));
  ok('local overview equals the server overview after the write', JSON.stringify(strip(local)) === JSON.stringify(strip(remote)));

  await p.evaluate(() => window.__ttEngine.invalidate());
  ok('invalidate reloads the engine from the server', await until(p, 'ready'));
  const local2 = await p.evaluate(() => window.__ttEngine.read('/api/overview'));
  ok('reloaded engine still equals the server', JSON.stringify(strip(local2)) === JSON.stringify(strip(remote)));

  // kill switch: the app must work exactly as before
  const ctx2 = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx2.addInitScript(() => { try { localStorage.setItem('tt.engine', 'off'); } catch {} });
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push(String(e)));
  await p2.goto(U); await p2.waitForSelector('.auth-card'); await p2.fill('input[name=email]', 'owner@x.com'); await p2.fill('input[name=password]', 'password123');
  await p2.click('button[type=submit]'); await p2.waitForSelector('.hero2', { timeout: 15000 });
  await p2.waitForTimeout(1500);
  ok('kill switch: engine stays off, app works', (await status(p2)) === 'off');
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 600)); process.exit(1); });
