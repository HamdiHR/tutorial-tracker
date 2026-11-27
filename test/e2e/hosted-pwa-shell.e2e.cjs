// The installable shell: manifest + icons valid, service worker takes control, the app opens with the network cut,
// a dropped connection does not sign you out, and a new deployment is offered (never forced).
const fs = require('node:fs');
const path = require('node:path');
const { chromium, ok, U, done } = require('./helpers.cjs');
const SW = path.resolve(__dirname, '../../public/sw.js');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'allow' });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(U); await p.waitForSelector('.auth-card');
  // manifest
  const href = await p.locator('link[rel=manifest]').getAttribute('href');
  const man = await (await ctx.request.get(new URL(href, U).href)).json();
  ok('manifest basics', man.display === 'standalone' && man.start_url && man.name === 'Tutorial Tracker' && man.icons.length >= 3);
  for (const ic of man.icons) { const r = await ctx.request.get(new URL(ic.src, U).href); ok('icon ' + ic.src + ' loads as png', r.ok() && (r.headers()['content-type'] || '').includes('png')); }
  ok('maskable icon declared', man.icons.some((i) => i.purpose === 'maskable'));
  // service worker takes control (after a reload on first install)
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForSelector('.auth-card');
  ok('service worker controls the page', await p.evaluate(() => !!navigator.serviceWorker.controller));
  const keys = await p.evaluate(async () => (await caches.keys()));
  ok('shell cache exists', keys.some((k) => k.startsWith('tt-shell-')), keys.join(','));
  // sign up and use the app online
  await p.click('text=Create account');
  await p.fill('input[name=email]', 'owner@x.com'); await p.fill('input[name=password]', 'password123'); await p.fill('input[name=again]', 'password123'); await p.click('button[type=submit]');
  await p.waitForSelector('.ob-choice', { timeout: 8000 }).catch(async () => { console.log('SCREEN:', (await p.locator('body').innerText()).slice(0, 300)); throw new Error('sign-up did not reach onboarding'); }); await p.click('.ob-choice >> nth=0'); await p.waitForSelector('.hero2', { timeout: 15000 });
  const sessionBefore = await p.evaluate(() => localStorage.getItem('tt.session'));
  ok('config remembered for offline start', !!(await p.evaluate(() => localStorage.getItem('tt.cfg'))));
  // offline: reload still opens the app shell, shows a clear message, keeps the sign-in
  // This test covers an offline start WITHOUT a device copy of the data (engine switched off). With a copy the app opens: see hosted-offline-start.e2e.cjs.
  await p.evaluate(() => localStorage.setItem('tt.engine', 'off'));
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('.auth-card, .pwa-bar', { timeout: 10000 });
  ok('opens offline with a clear message', /Cannot reach the server/.test(await p.locator('body').innerText()));
  ok('page title came from the cached shell', (await p.title()) === 'Tutorial Tracker');
  ok('offline bar or screen shown', (await p.locator('.pwa-bar.off').count()) === 1);
  ok('still signed in after offline reload', (await p.evaluate(() => localStorage.getItem('tt.session'))) === sessionBefore);
  // expired token + offline must not sign you out
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt.session')); s.expires_at = 1; localStorage.setItem('tt.session', JSON.stringify(s)); });
  await p.reload(); await p.waitForSelector('.auth-card', { timeout: 10000 });
  ok('expired token offline: still not signed out', !!(await p.evaluate(() => localStorage.getItem('tt.session'))));
  await ctx.setOffline(false);
  await p.reload(); await p.waitForSelector('.hero2', { timeout: 15000 });
  ok('back online: app works again, no new sign-in', (await p.locator('.auth-card').count()) === 0);
  // a new deployment: the new worker waits, the person is asked, and only "Reload" switches versions
  const orig = fs.readFileSync(SW, 'utf8');
  const oldKey = (await p.evaluate(async () => (await caches.keys()).find((k) => k.startsWith('tt-shell-'))));
  const packed = ['.br', '.gz'].map((x) => [SW + x, fs.existsSync(SW + x) ? fs.readFileSync(SW + x) : null]);
  try {
    for (const x of ['.br', '.gz']) fs.rmSync(SW + x, { force: true });
    fs.writeFileSync(SW, orig.replace(/const VERSION = '[^']*'/, "const VERSION = 'testnext'"));
    await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await p.waitForSelector('.pwa-bar:has-text("new version")', { timeout: 15000 });
    ok('update is offered', true);
    ok('page was not reloaded by itself', await p.evaluate(() => performance.getEntriesByType('navigation').length >= 1) && (await p.locator('.hero2').count()) === 1);
    await p.click('.pwa-bar >> text=Reload');
    await p.waitForFunction(async (k) => !(await caches.keys()).includes(k), oldKey, { timeout: 15000 });
    await p.waitForSelector('.hero2', { timeout: 15000 });
    const keys = await p.evaluate(async () => await caches.keys());
    ok('new version active, old cache removed', keys.includes('tt-shell-testnext') && !keys.includes(oldKey), keys.join(','));
  } finally { fs.writeFileSync(SW, orig); for (const [f, buf] of packed) if (buf) fs.writeFileSync(f, buf); }
  done(errs.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|Load failed/.test(e)));
  await b.close();
})().catch((e) => { console.log('FAIL', e.message.slice(0, 400)); process.exit(1); });
