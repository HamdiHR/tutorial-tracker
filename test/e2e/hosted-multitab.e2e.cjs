// Two tabs of the same browser (v0.41): only one owns the engine and the outbox; the other uses the server directly,
// the owner hears about its saves, nothing waiting is lost on sign-out checks, and when the owner closes the other takes over.
const { chromium, ok, U, done } = require('./helpers.cjs');
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const A = await ctx.newPage(); A.on('pageerror', (e) => errs.push('A ' + e));
  await A.goto(U); await A.waitForSelector('.auth-card'); await A.click('text=Create account');
  await A.fill('input[name=email]', 'owner@x.com'); await A.fill('input[name=password]', 'password123'); await A.fill('input[name=again]', 'password123'); await A.click('button[type=submit]');
  await A.waitForSelector('.ob-choice'); await A.click('.ob-choice >> nth=0'); await A.waitForSelector('.hero2', { timeout: 15000 });
  ok('first tab is the leader and ready', await until(A, () => window.__ttEngine.role() === 'leader' && window.__ttEngine.status() === 'ready' && window.__ttEngine.source() === 'server'));
  const tok = JSON.parse(await A.evaluate(() => localStorage.getItem('tt.session'))).access_token;
  const server = async (m, u) => (await fetch(U + 'api' + u, { method: m, headers: { authorization: 'Bearer ' + tok } })).json();
  const tid = (await server('GET', '/overview')).sprints[0].items.find((x) => x.kind === 'ticket').id;
  const steps = (await server('GET', '/tickets/' + tid)).steps.filter((s) => s.kind === 'step');
  const aDone = async () => (await A.evaluate(() => window.__ttEngine.read('/api/overview')))?.totals?.stepsDone;

  const B = await ctx.newPage(); B.on('pageerror', (e) => errs.push('B ' + e));
  await B.goto(U + `#/t/${encodeURIComponent(tid)}/${steps[0].id}`); await B.waitForSelector('.toggle-done', { timeout: 20000 });
  ok('second tab is a follower (no engine of its own)', (await until(B, () => window.__ttEngine.role() === 'follower', null, 8000)) && (await B.evaluate(() => window.__ttEngine.status())) !== 'ready');
  await A.waitForTimeout(500);

  // the follower saves through the server; the leader hears about it and catches up
  const before = await aDone();
  await B.click('.toggle-done');
  let n = before; for (let i = 0; i < 30 && n !== before + 1; i++) { await A.waitForTimeout(300); n = (await server('GET', '/overview')).totals.stepsDone; }
  ok('follower save reached the server', n === before + 1, `${before} -> ${n}`);
  ok('the leader caught up by itself', await until(A, async (n) => (await window.__ttEngine.read('/api/overview'))?.totals?.stepsDone === n, before + 1, 15000), String(await aDone()));

  // the leader holds waiting changes; any tab can see them before a sign-out
  await ctx.setOffline(true);
  await A.evaluate((id) => window.__ttEngine.enqueue(crypto.randomUUID(), 'PUT', `/api/steps/${id}/note`, { note: 'a' }), steps[1].id);
  await A.evaluate((id) => window.__ttEngine.enqueue(crypto.randomUUID(), 'PUT', `/api/steps/${id}/note`, { note: 'b' }), steps[2].id);
  const waiting = await A.evaluate(() => window.__ttEngine.pending());
  ok('follower sees the leader\'s waiting changes (shared outbox)', (await B.evaluate(() => window.__ttEngine.pendingAny())) === waiting && waiting >= 2, `${waiting}`);
  ok('follower itself still accepts nothing silently offline (it says it cannot reach the server)', (await B.evaluate(() => window.__ttEngine.canQueue('PUT', '/api/steps/1/note'))) === false);

  // the leader tab closes: the follower takes over and keeps the waiting changes
  await A.close();
  ok('follower took over', await until(B, () => window.__ttEngine.role() === 'leader' && window.__ttEngine.status() === 'ready', null, 20000));
  ok('and holds the same waiting changes', (await B.evaluate(() => window.__ttEngine.pending())) === waiting);
  await ctx.setOffline(false);
  ok('which it uploads', await until(B, () => window.__ttEngine.pending() === 0, null, 30000));
  ok('server has both notes', (await server('GET', '/tickets/' + tid)).steps.filter((s) => ['a', 'b'].includes(s.note)).length === 2);
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 900)); process.exit(1); });
