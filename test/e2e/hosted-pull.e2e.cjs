// Pull (v0.40 phase 4): another device changes your data while this one stays open. The app notices, offers a Refresh, and never
// raises a false alarm for its own saves.
const { chromium, ok, U, done } = require('./helpers.cjs');
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(U); await p.waitForSelector('.auth-card'); await p.click('text=Create account');
  await p.fill('input[name=email]', 'owner@x.com'); await p.fill('input[name=password]', 'password123'); await p.fill('input[name=again]', 'password123'); await p.click('button[type=submit]');
  await p.waitForSelector('.ob-choice'); await p.click('.ob-choice >> nth=0'); await p.waitForSelector('.hero2', { timeout: 15000 });
  const tok = JSON.parse(await p.evaluate(() => localStorage.getItem('tt.session'))).access_token;
  const server = async (m, u, body) => (await fetch(U + 'api' + u, { method: m, headers: { authorization: 'Bearer ' + tok, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const tid = (await server('GET', '/overview')).sprints[0].items.find((x) => x.kind === 'ticket').id;
  const steps = (await server('GET', '/tickets/' + tid)).steps.filter((s) => s.kind === 'step');
  const ready = () => until(p, () => window.__ttEngine.status() === 'ready' && window.__ttEngine.source() === 'server', null, 20000);
  const pull = () => p.evaluate(() => window.__ttEngine.pull());
  const localDone = async () => (await p.evaluate(() => window.__ttEngine.read('/api/overview')))?.totals?.stepsDone;
  ok('ready', await ready());
  await sleep(3000); // let the first device-copy refresh finish

  ok('first look: nothing new', ['same'].includes(await pull()));
  // this device's own saves are not "another device"
  await p.evaluate((id) => fetch(`/api/steps/${id}/done`, { method: 'POST', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('tt.session')).access_token, 'content-type': 'application/json' }, body: '{}' }), steps[0].id).catch(() => {});
  await p.goto(U + `#/t/${encodeURIComponent(tid)}/${steps[1].id}`); await p.waitForSelector('.toggle-done'); await p.click('.toggle-done'); await sleep(3500);
  ok('own save: no false alarm', (await pull()) === 'same' && (await p.locator('.pwa-bar', { hasText: 'Another device' }).count()) === 0);
  const mine = await localDone();

  // another device ticks two steps
  await server('POST', `/steps/${steps[2].id}/done`, { done: true }); await server('POST', `/steps/${steps[3].id}/done`, { done: true });
  ok('this device has not seen it yet', (await localDone()) === mine);
  ok('pull finds the change', (await pull()) === 'changed');
  ok('the engine now holds the other device\'s work', await until(p, (m) => window.__ttEngine.status() === 'ready', null, 20000) && (await localDone()) === mine + 2, `${mine} -> ${await localDone()}`);
  ok('the Refresh bar is offered', (await p.locator('.pwa-bar', { hasText: 'Another device changed your data' }).count()) === 1);
  ok('pulling again: same', (await pull()) === 'same');

  // not while changes are waiting to upload
  await ctx.setOffline(true);
  await p.evaluate((id) => window.__ttEngine.enqueue(crypto.randomUUID(), 'PUT', `/api/steps/${id}/note`, { note: 'x' }), steps[4].id);
  ok('skipped while offline / changes waiting', (await pull()) === 'skipped');
  await ctx.setOffline(false);
  ok('uploaded', await until(p, () => window.__ttEngine.pending() === 0, null, 30000));
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 900)); process.exit(1); });
