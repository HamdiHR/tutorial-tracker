// Offline start (v0.40 P3-4/P3-5): after one online visit the app opens with NO network, from the device copy of the person's data
// (IndexedDB) and the engine files cached by the service worker. Back online it reloads from the server; sign-out wipes the device copy.
// This test only covers reading; offline saving is in hosted-offline-write.e2e.cjs.
const { chromium, ok, U, done } = require('./helpers.cjs');
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const kvKeys = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('tt-device', 1); r.onerror = () => res(null); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv'); const k = tx.objectStore('kv').getAllKeys(); k.onsuccess = () => res(k.result); }; }));
const engineCache = (p) => p.evaluate(() => new Promise(async (res) => { const reg = await navigator.serviceWorker.ready; navigator.serviceWorker.addEventListener('message', (e) => e.data?.type === 'ENGINE_STATUS' && res(e.data)); reg.active.postMessage('ENGINE_STATUS'); setTimeout(() => res(null), 4000); }));

(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(U); await p.waitForSelector('.auth-card'); await p.click('text=Create account');
  await p.fill('input[name=email]', 'owner@x.com'); await p.fill('input[name=password]', 'password123'); await p.fill('input[name=again]', 'password123'); await p.click('button[type=submit]');
  await p.waitForSelector('.ob-choice'); await p.click('.ob-choice >> nth=0'); await p.waitForSelector('.hero2', { timeout: 15000 });
  ok('engine ready online', await until(p, () => window.__ttEngine?.status() === 'ready' && window.__ttEngine.source() === 'server'));

  // one real change, so the device copy must contain it
  const tok = JSON.parse(await p.evaluate(() => localStorage.getItem('tt.session'))).access_token;
  const server = async (m, u) => (await fetch(U + 'api' + u, { method: m, headers: { authorization: 'Bearer ' + tok } })).json();
  const tid = (await server('GET', '/overview')).sprints[0].items.find((x) => x.kind === 'ticket').id;
  const step = (await server('GET', '/tickets/' + tid)).steps.find((s) => s.kind === 'step');
  await p.goto(U + `#/t/${encodeURIComponent(tid)}/${step.id}`); await p.waitForSelector('.toggle-done'); await p.click('.toggle-done');
  await p.waitForTimeout(4500); // the device copy refreshes ~2.5 s after a write

  let c = null; for (let i = 0; i < 20 && !(c && c.cached === c.total && c.total === 3); i++) { c = await engineCache(p); if (!(c && c.cached === c.total)) await p.waitForTimeout(1000); }
  ok('service worker cached the engine files (3 of 3)', c && c.cached === 3 && c.total === 3, JSON.stringify(c));
  ok('device copy is stored for this person', (await kvKeys(p))?.some((k) => String(k).startsWith('state:')), JSON.stringify(await kvKeys(p)));

  // ---- offline
  await ctx.setOffline(true);
  await p.goto(U + '#/'); await p.reload(); await p.waitForSelector('.hero2', { timeout: 20000 }).catch(() => {});
  ok('app opens offline (not the offline screen)', (await p.locator('.hero2').count()) > 0);
  ok('engine ready from the device copy', await until(p, () => window.__ttEngine?.status() === 'ready' && window.__ttEngine.source() === 'device'), await p.evaluate(() => window.__ttEngine?.status() + '/' + window.__ttEngine?.source()));
  const ov = await p.evaluate(() => window.__ttEngine.read('/api/overview'));
  ok('offline data includes the step ticked before', ov?.totals?.stepsDone === 1, JSON.stringify(ov?.totals));
  await p.goto(U + `#/t/${encodeURIComponent(tid)}/${step.id}`); await p.waitForSelector('.toggle-done', { timeout: 10000 }).catch(() => {});
  ok('a task opens offline', (await p.locator('.toggle-done').count()) > 0);

  // ---- back online
  await ctx.setOffline(false);
  ok('back online: engine reloads from the server', await until(p, () => window.__ttEngine?.status() === 'ready' && window.__ttEngine.source() === 'server', null, 20000), await p.evaluate(() => window.__ttEngine?.status() + '/' + window.__ttEngine?.source()));

  // ---- sign out wipes the device copy
  await p.goto(U + '#/settings'); await p.waitForSelector('text=Sign out', { timeout: 15000 }).catch(async () => console.log('settings page text:', (await p.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' | '))); await p.click('text=Sign out'); await p.waitForSelector('.auth-card', { timeout: 15000 });
  const keys = await kvKeys(p);
  ok('sign-out wipes the device copy', Array.isArray(keys) && keys.length === 0, JSON.stringify(keys));
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 700)); process.exit(1); });
