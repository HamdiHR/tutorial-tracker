// Two devices change the same note while apart (v0.40 phase 4): the newest version is the note, the other is kept as a visible
// "Conflict copy"; untouched notes and a device's own repeated edits are never flagged as conflicts.
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
  const [s1, s2, s3] = steps;
  const note = async (s) => (await server('GET', '/tickets/' + tid)).steps.find((x) => x.id === s.id).note;
  const setNote = (s, n) => server('PUT', `/steps/${s.id}/note`, { note: n });
  const offlineNote = (s, n) => p.evaluate(([id, n]) => window.__ttEngine.enqueue(crypto.randomUUID(), 'PUT', `/api/steps/${id}/note`, { note: n }), [s.id, n]);
  const ready = () => until(p, () => window.__ttEngine.status() === 'ready' && window.__ttEngine.source() === 'server', null, 20000);

  await setNote(s1, 'base1'); await setNote(s2, 'base2'); await setNote(s3, 'base3');
  await p.evaluate(() => window.__ttEngine.invalidate()); ok('device has the starting notes', await ready());

  // case 1: this device edits offline, another device edits the same note LATER -> the other one is newest
  await ctx.setOffline(true);
  await offlineNote(s1, 'offline1'); await sleep(1200);
  await setNote(s1, 'server1'); // "the other device", at a later time
  // case 2: another device edited FIRST (this device has not seen it), then this device edits offline later -> this device is newest
  await setNote(s2, 'server2'); await sleep(1200);
  await offlineNote(s2, 'offline2');
  // case 3: nobody else touched it; two edits in a row from this device (must not conflict with itself)
  await offlineNote(s3, 'plain1'); await offlineNote(s3, 'plain2');

  await ctx.setOffline(false);
  ok('everything uploaded', await until(p, () => window.__ttEngine.pending() === 0, null, 30000));
  const n1 = await note(s1), n2 = await note(s2), n3 = await note(s3);
  ok('case 1: the newer note (other device) is the value', n1.startsWith('server1'), JSON.stringify(n1));
  ok('case 1: the offline text is kept as a Conflict copy', /Conflict copy/.test(n1) && n1.includes('offline1'), JSON.stringify(n1));
  ok('case 2: the newer note (this device) is the value', n2.startsWith('offline2'), JSON.stringify(n2));
  ok('case 2: the older text is kept as a Conflict copy', /Conflict copy/.test(n2) && n2.includes('server2'), JSON.stringify(n2));
  ok('case 3: no conflict, last edit wins, nothing appended', n3 === 'plain2', JSON.stringify(n3));
  ok('two conflicts counted', (await p.evaluate(() => window.__ttEngine.conflictCount())) === 2);
  ok('banner explains it', (await p.locator('.pwa-bar', { hasText: 'Conflict copy' }).count()) === 1);
  ok('screens show the server result after the conflict (reloaded from the server)', await until(p, () => window.__ttEngine.status() === 'ready' && window.__ttEngine.source() === 'server', null, 20000));
  await p.click('.pwa-bar button:has-text("OK")');
  ok('OK clears the banner', (await p.evaluate(() => window.__ttEngine.conflictCount())) === 0);
  done(errs); await b.close();
})().catch((e) => { console.log('FAIL', String(e.stack || e).slice(0, 900)); process.exit(1); });
