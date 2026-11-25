// Bundles the browser engine into public/engine/: worker.js (server engine + SQLite WASM adapter), sqlite3.wasm, content.db.
// Run after `npm run build` (which wipes only public/assets and the shell files) and `npm run build:content`.
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/engine');
const shim = (n) => path.join(root, 'web/engine/shims', n + '.js');
(async () => {
  const content = path.join(root, 'hosted/content.db');
  if (!fs.existsSync(content)) throw new Error('hosted/content.db missing: run `npm run build:content` first');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    absWorkingDir: root, entryPoints: ['web/engine/worker.js'], outfile: 'public/engine/worker.js', bundle: true, format: 'esm', platform: 'browser',
    minify: !process.argv.includes('--dev'), legalComments: 'none', logLevel: 'warning', target: ['chrome105', 'edge105', 'firefox110', 'safari16'],
    alias: { 'node:sqlite': shim('node-sqlite'), 'node:fs': shim('fs'), 'node:os': shim('os'), 'node:path': shim('path'), 'node:crypto': shim('crypto') },
    define: { 'process.version': '"browser"' },
  });
  fs.copyFileSync(path.join(root, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), path.join(out, 'sqlite3.wasm'));
  fs.copyFileSync(content, path.join(out, 'content.db'));
  const kb = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0);
  console.log(`built public/engine: worker.js ${kb('worker.js')} KB, sqlite3.wasm ${kb('sqlite3.wasm')} KB, content.db ${kb('content.db')} KB`);
})().catch((e) => { console.error(e.message); process.exit(1); });
