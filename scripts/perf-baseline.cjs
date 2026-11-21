const { chromium } = require('playwright');
// Usage: start the app (e.g. PORT=4199), then: node scripts/perf-baseline.cjs <cpuSlowdown, default 4>
// Needs Playwright (dev only) and a saved timeline plan so the Board/Timeline pages have data.
const U = process.env.PERF_URL || 'http://localhost:4199/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.argv[2] || 4) });
  let reqs = []; p.on('request', r => r.url().includes('/api/') && reqs.push(r.method() + ' ' + r.url().replace(U, '').split('?')[0]));
  await p.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); });
  const m = async () => { const r = await cdp.send('Performance.getMetrics'); return Object.fromEntries(r.metrics.map(x => [x.name, x.value])); };
  const measure = async (name, fn, settle = '#view > *') => {
    reqs = []; await p.evaluate(() => (window.__lt = [])); const a = await m(); const t0 = Date.now();
    await fn(); await p.waitForTimeout(900); const z = await m();
    const lt = await p.evaluate(() => window.__lt);
    const nodes = await p.evaluate(() => document.querySelectorAll('*').length);
    console.log(name.padEnd(34), 'script', ((z.ScriptDuration - a.ScriptDuration) * 1000).toFixed(0).padStart(5), 'ms | layout', ((z.LayoutDuration - a.LayoutDuration) * 1000).toFixed(0).padStart(4), '| style', ((z.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(0).padStart(4), '| longtasks', JSON.stringify(lt), '| DOM', nodes, '| api', reqs.length, '[' + [...new Set(reqs)].join(',').slice(0, 70) + ']');
  };
  // initial load
  reqs = []; const t0 = Date.now(); await p.goto(U); await p.waitForSelector('.hero2'); const load = Date.now() - t0;
  const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const r = performance.getEntriesByType('resource').map(e => e.name.split('/').pop() + ':' + Math.round(e.transferSize / 1024) + 'KB/' + Math.round(e.duration) + 'ms'); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), res: r }; });
  const paints = await p.evaluate(() => performance.getEntriesByType('paint').map(e => e.name + ':' + Math.round(e.startTime)));
  console.log('INITIAL (cpu x' + (process.argv[2] || 4) + ') ready-to-hero', load, 'ms', JSON.stringify(nav), paints.join(' '), 'api', reqs.join(','));
  await measure('dashboard (re-nav)', async () => { await p.goto(U + '#/timeline'); await p.waitForTimeout(300); await p.goto(U + '#/'); });
  await measure('board open (147 cards)', () => p.goto(U + '#/board'));
  await p.waitForTimeout(500);
  await measure('board: group by sprint toggle', () => p.click('.tgl:has-text("Group by sprint") input'));
  await measure('board: group off', () => p.click('.tgl:has-text("Group by sprint") input'));
  const card = p.locator('.bcol.todo .bcard').first(); const tid = await card.getAttribute('data-tid');
  await measure('board: move card via menu', () => (async () => { await p.locator(`[data-tid="${tid}"] .mvb`).click({ force: true }); await p.click('.pop-menu button:has-text("Ongoing")'); })());
  await measure('timeline open (sprint view)', () => p.goto(U + '#/timeline'));
  await measure('timeline tasks view (147 bars)', () => p.click('.seg button:has-text("Tasks")'));
  await measure('timeline zoom in', () => p.click('button[title="Zoom in"]'));
  await measure('ticket open (S1-T01)', () => p.goto(U + '#/t/S1-T01'));
  await measure('ticket: next slide', () => p.keyboard.press('ArrowRight'));
  const np = await p.locator('.rail .pill').count(); for (let i = 0; i < np && !(await p.locator('.toggle-done').count()); i++) await p.locator('.rail .pill').nth(i).click();
  await measure('ticket: toggle step done', () => p.click('.toggle-done'));
  await measure('manage page', () => p.goto(U + '#/manage'));
  await measure('achievements', () => p.goto(U + '#/achievements'));
  await measure('drift inbox (153)', () => p.goto(U + '#/drift'));
  await measure('search ctrl+k "drizzle"', async () => { await p.keyboard.press('Control+k'); await p.keyboard.type('drizzle', { delay: 30 }); });
  const heap = await m(); console.log('JS heap', Math.round(heap.JSHeapUsedSize / 1048576) + 'MB', 'listeners', heap.JSEventListeners, 'nodes', heap.Nodes);
  await b.close();
})();
