// Shared by the browser tests. `ok` prints PASS/FAIL and makes the process exit non-zero on a failure.
const { chromium } = require('playwright');
let failed = 0;
const U = (process.env.E2E_URL || 'http://localhost:4412/').replace(/\/?$/, '/');
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); };
const done = (errs = []) => { if (errs.length) { failed++; console.log('FAIL page errors:', errs); } process.exitCode = failed ? 1 : 0; };
module.exports = { chromium, ok, U, done };
