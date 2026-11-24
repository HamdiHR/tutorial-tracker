// Browser tests. Each file in test/e2e gets a fresh app (local files: new empty data folder; hosted-*: the Supabase
// stand-in on real Postgres, only when PGHOST is set). Usage: node test/e2e/run.cjs [name-filter]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.resolve(__dirname, '../..');
const filter = process.argv[2] || '';
const free = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = async (url, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 200)); } throw new Error('server did not start: ' + url); };
const today = () => new Date().toISOString().slice(0, 10);
const run = (file, env) => new Promise((res) => { const c = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: 'inherit' }); c.on('exit', (code) => res(code)); });

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'public', 'index.html'))) { console.log('building public/ ...'); await run(path.join(ROOT, 'scripts/build.cjs'), {}); }
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.cjs') && f.includes(filter)).sort();
  let bad = 0;
  for (const f of files) {
    const hosted = f.startsWith('hosted-');
    if (hosted && !process.env.PGHOST) { console.log(`SKIP ${f} (set PGHOST/PGPORT/PGUSER to run hosted tests)`); continue; }
    console.log(`\n=== ${f}`);
    const port = await free(), fake = await free();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-e2e-'));
    const env = hosted ? { PORT: String(port), FAKE_PORT: String(fake) } : { PORT: String(port), DATA_DIR: dir };
    const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', hosted ? 'hosted/test/dev-server.js' : 'server/index.js'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
    try {
      await wait(`http://127.0.0.1:${port}/api/config`);
      if (!hosted) await fetch(`http://127.0.0.1:${port}/api/plan?today=${today()}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startDate: today(), workDays: [1, 2, 3, 4, 5], sprintDays: 5, anchor: 'here', perSprint: {}, daysOff: [], team: [{ name: 'You' }] }) });
      const code = await run(path.join(__dirname, f), { E2E_URL: `http://localhost:${port}/` });
      if (code) bad++;
    } catch (e) { console.log('FAIL', f, e.message); bad++; }
    finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
  console.log(bad ? `\n${bad} browser test file(s) failed` : '\nAll browser tests passed');
  process.exit(bad ? 1 : 0);
})();
