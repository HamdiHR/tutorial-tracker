#!/usr/bin/env node
// CI guard: the live app and git must agree on the version. Fails when
//  - package-lock.json disagrees with package.json, or
//  - a pull request changes the app (web/, server/, hosted/, api/, scripts/, content/) but not the version (run `npm run release`).
// Usage: node scripts/check-version.cjs [base-ref]   (base-ref only given on pull requests, e.g. origin/main)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pkg = read('package.json');
let bad = 0;
const fail = (m) => { console.error('version check FAILED: ' + m); bad++; };
if (fs.existsSync(path.join(root, 'package-lock.json'))) { const l = read('package-lock.json'); if (l.version !== pkg.version || (l.packages?.[''] && l.packages[''].version !== pkg.version)) fail(`package-lock.json says ${l.version}, package.json says ${pkg.version}. Run: npm run release (or npm install).`); }
const base = process.argv[2];
if (base) {
  try {
    const was = JSON.parse(git('show', `${base}:package.json`)).version;
    const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter((f) => /^(web|server|hosted|api|scripts|content)\//.test(f));
    if (changed.length && was === pkg.version) fail(`the app changed (${changed.length} file${changed.length > 1 ? 's' : ''}, e.g. ${changed[0]}) but the version is still ${pkg.version}. Run: npm run release`);
    else console.log(`version ok: ${was} -> ${pkg.version}`);
  } catch (e) { console.log('version check: could not compare with ' + base + ' (' + String(e.message).split('\n')[0] + '), skipped'); }
} else console.log('version ok: ' + pkg.version);
process.exit(bad ? 1 : 0);
