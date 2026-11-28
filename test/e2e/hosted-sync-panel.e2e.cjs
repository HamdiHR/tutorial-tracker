// Sync panel (v0.40 phase 4): status chip, list of waiting changes, Sync now, JSON export, reset this device, and the sign-out warning.
const { chromium, ok, U, done } = require('./helpers.cjs');
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(U); await p.waitForSelector('.auth-card'); await p.click('text=Create account');
  await p.fill('input[name=email]', 'owner@x.com'); await p.fill('input[name=password]', 'password123'); await p.fill('input[name=again]', 'password123'); await p.click('button[type=submit]');
  await p.waitForSelector('.ob-choice'); await p.click('.ob-choice >> nth=0'); await p.waitForSelector('.hero2', { timeout: 15000 });
  ok('engine ready', await until(p, () => window.__ttEngine?.status() === 'ready' && window.__ttEngine.source() === 'server'));
  const tok = JSON.parse(await p.evaluate(() => localStorage.getItem('tt.session'))).access_token;
  const server = async (m, u) => (await fetch(U + 'api' + u, { method: m, headers: { authorization: 'Bearer ' + tok } })).json();
  const tid = (await server('GET', '/overview')).sprints[0].items.find((x) => x.kind === 'ticket').id;
  const steps = (await server('GET', '/tickets/' + tid)).steps.filter((s) => s.kind === 'step');

  ok('chip hidden when everything is saved', await p.locator('#sync-chip').isHidden());
  await p.goto(U + '#/settings'); await p.waitForSelector('text=Sync and offline');
  ok('panel says nothing is waiting', (await p.locator('text=Nothing is waiting').count()) === 1);

  await ctx.setOffline(true);
  await p.evaluate((id) => window.__ttEngine.enqueue(crypto.randomUUID(), 'PUT', `/api/steps/${id}/note`, { note: 'x' }), steps[0].id);
  await p.evaluate((id) => window.__ttEngine.enqueue(crypto.randomUUID(), 'POST', `/api/steps/${id}/done`, { done: true }), steps[1].id);
  ok('chip shows offline + 2 waiting', await until(p, () => /Offline · 2 waiting/.test(document.querySelector('#sync-chip')?.textContent || ''), null, 5000), await p.locator('#sync-chip').textContent());
  ok('panel lists the waiting changes by name', (await p.locator('text=Step note').count()) >= 1 && (await p.locator('text=Tick or untick a step').count()) >= 1);

  // export works offline (from the device copy) and includes the waiting changes
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Export my data (JSON)')]);
  const fs = require('node:fs'); const j = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok('export has the state and the waiting changes', j.state && Array.isArray(j.state.steps) && j.waiting_changes.length === 2 && j.from === 'this device', JSON.stringify({ from: j.from, w: j.waiting_changes?.length }));

  // sign-out warns while changes wait; answering "cancel" keeps the session
  let asked = null; p.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await p.click('text=Sign out'); await p.waitForTimeout(500);
  ok('sign-out warns about waiting changes', /2 changes are still waiting/.test(asked || ''), String(asked));
  ok('still signed in after cancelling', (await p.locator('.auth-card').count()) === 0 && (await p.evaluate(() => window.__ttEngine.pending())) === 2);

  // back online: Sync now uploads, chip goes away
  await ctx.setOffline(false);
  await p.click('text=Sync now');
  ok('uploaded', await until(p, () => window.__ttEngine.pending() === 0, null, 30000));
  ok('chip hidden again', await until(p, () => document.querySelector('#sync-chip')?.hidden === true, null, 5000));
  ok('server has the offline work', (await server('GET', '/overview')).totals.stepsDone === 1);
  ok('"Last synced" is filled in', (await p.locator('text=Last synced: never').count()) === 0);

  // reset this device's copy: confirm, then a fresh copy loads
  p.once('dialog', (d) => d.accept());
  await p.click("text=Reset this device's copy");
  await until(p, () => window.__ttEngine.status() !== 'ready', null, 5000); // the reset has started
  ok('fresh copy loaded from the server', await until(p, () => window.__ttEngine.status() === 'ready' && window.__ttEngine.source() === 'server', null, 20000));
  const afterReset = await p.evaluate(() => window.__ttEngine.read('/api/overview')); ok('still shows the work after reset', afterReset?.totals?.stepsDone === 1, JSON.stringify(afterReset?.totals) + ' / ' + await p.evaluate(() => window.__ttEngine.status()));
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 900)); process.exit(1); });
