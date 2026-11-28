// Offline saving (v0.40 phase 4, client): with no network, ticks are saved on this device (outbox in IndexedDB), the screens show
// them at once, they survive a reload, and when the network is back they upload in order, once, and nothing is lost or doubled.
const { chromium, ok, U, done } = require('./helpers.cjs');
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(U); await p.waitForSelector('.auth-card'); await p.click('text=Create account');
  await p.fill('input[name=email]', 'owner@x.com'); await p.fill('input[name=password]', 'password123'); await p.fill('input[name=again]', 'password123'); await p.click('button[type=submit]');
  await p.waitForSelector('.ob-choice'); await p.click('.ob-choice >> nth=0'); await p.waitForSelector('.hero2', { timeout: 15000 });
  ok('engine ready online', await until(p, () => window.__ttEngine?.status() === 'ready' && window.__ttEngine.source() === 'server'));

  const tok = JSON.parse(await p.evaluate(() => localStorage.getItem('tt.session'))).access_token;
  const server = async (m, u, body, extra) => (await fetch(U + 'api' + u, { method: m, headers: { authorization: 'Bearer ' + tok, ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined })).json();
  const tid = (await server('GET', '/overview')).sprints[0].items.find((x) => x.kind === 'ticket').id;
  const steps = (await server('GET', '/tickets/' + tid)).steps.filter((s) => s.kind === 'step');
  const open = async (s) => { await p.goto(U + `#/t/${encodeURIComponent(tid)}/${s.id}`); await p.waitForSelector('.toggle-done'); };
  const doneCount = async () => (await server('GET', '/overview')).totals.stepsDone;
  const pending = () => p.evaluate(() => window.__ttEngine.pending());
  ok('starts with nothing waiting', (await pending()) === 0);

  // ---- offline: tick step 1, tick step 2, untick step 2
  await ctx.setOffline(true);
  await open(steps[0]); await p.click('.toggle-done'); await p.waitForTimeout(400);
  const n1 = await pending(); ok('changes are waiting after the first tick (the tick, plus the "where you are" bookmark)', n1 >= 1, String(n1));
  ok('no error shown for an offline save', (await p.locator('.toast.err, .toast.error').count()) === 0);
  ok('"waiting to upload" bar is visible', (await p.locator('.pwa-bar', { hasText: 'waiting to upload' }).count()) === 1);
  await open(steps[1]); await p.click('.toggle-done'); await p.waitForTimeout(300);
  await p.click('.toggle-done'); await p.waitForTimeout(300);
  const n3 = await pending(); ok('more changes waiting after two more ticks', n3 >= n1 + 2, `${n1} -> ${n3}`);
  const localDone = async () => (await p.evaluate(() => window.__ttEngine.read('/api/overview')))?.totals?.stepsDone;
  ok('screens already show the offline work (1 step done)', (await localDone()) === 1, String(await localDone()));

  // ---- a reload while still offline: the waiting changes survive and are shown again
  await p.reload(); await p.waitForSelector('.hero2', { timeout: 20000 }).catch(() => {});
  ok('engine ready again offline', await until(p, () => window.__ttEngine?.status() === 'ready'));
  ok('waiting changes survived the reload', (await pending()) >= n3, `${n3} -> ${await pending()}`);
  ok('and are applied on top of the device copy (1 done)', (await localDone()) === 1, String(await localDone()));

  // ---- back online: they upload, once, in order
  await ctx.setOffline(false);
  ok('everything uploaded', await until(p, () => window.__ttEngine.pending() === 0, null, 30000), String(await pending()));
  ok('server has exactly the offline result (1 step done)', (await doneCount()) === 1, String(await doneCount()));
  ok('nothing failed', (await p.evaluate(() => window.__ttEngine.failedCount())) === 0);
  ok('bar is gone', await until(p, () => !document.querySelector('.pwa-bar')?.textContent.includes('waiting to upload'), null, 5000));
  ok('engine still ready from the server', await until(p, () => window.__ttEngine.status() === 'ready' && window.__ttEngine.source() === 'server', null, 20000));
  ok('screens agree with the server', (await localDone()) === 1);

  // ---- the same operation id is never applied twice, even if an old retry arrives late
  const s3 = steps[2];
  const OP = '9f1d4c2e-7b1a-4c58-9d0e-0a1b2c3d4e5f';
  await server('POST', `/steps/${s3.id}/done`, { done: true }, { 'x-op-id': OP });
  ok('operation applied once', (await doneCount()) === 2);
  await server('POST', `/steps/${s3.id}/done`, { done: false }, { 'x-op-id': '1a2b3c4d-1111-4222-8333-444455556666' }); // a newer change
  await server('POST', `/steps/${s3.id}/done`, { done: true }, { 'x-op-id': OP }); // the old retry arrives again
  ok('late retry did not undo the newer change', (await doneCount()) === 1, String(await doneCount()));

  // ---- a second round: offline tick, online upload
  await ctx.setOffline(true);
  await open(steps[3]); await p.click('.toggle-done'); await p.waitForTimeout(300);
  await ctx.setOffline(false);
  ok('uploads again', await until(p, () => window.__ttEngine.pending() === 0, null, 30000));
  ok('server has 2 done now', (await doneCount()) === 2, String(await doneCount()));

  // ---- offline work is dated when it was made, not when it uploaded
  const recentTs = async () => (await server('GET', '/overview')).recent?.[0]?.ts;
  const s5 = steps[4];
  const made = Date.now() - 3 * 3600_000; // as if made 3 hours ago on a phone
  await server('PUT', `/steps/${s5.id}/note`, { note: 'made on the train' }, { 'x-op-id': '7e57a11c-0000-4000-8000-000000000001', 'x-op-time': String(made) });
  const ts1 = await recentTs();
  ok('activity is dated when the change was made (about 3 h ago)', ts1 && Math.abs(Date.parse(String(ts1).replace(' ', 'T').replace(/Z?$/, 'Z')) - made) < 120_000, String(ts1));
  const s6 = steps[5];
  await server('PUT', `/steps/${s6.id}/note`, { note: 'from a fast clock' }, { 'x-op-id': '7e57a11c-0000-4000-8000-000000000002', 'x-op-time': String(Date.now() + 3600_000) }); // a time in the future is ignored
  const ts2 = await recentTs();
  ok('a time in the future is ignored (dated now)', ts2 && Math.abs(Date.parse(String(ts2).replace(' ', 'T').replace(/Z?$/, 'Z')) - Date.now()) < 120_000, String(ts2));
  ok('the device knows its clock offset', typeof (await p.evaluate(() => window.__ttEngine.clockOffset())) === 'number');
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 900)); process.exit(1); });
