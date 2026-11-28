// One place that knows "which version and which build is this". Used by the build (sidebar badge, Settings) and the API (/api/config).
// version = package.json (bumped by `npm run release`); build = the git commit that produced it (Vercel/GitHub set it, locally we ask git).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function build() {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try { return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}
function info() {
  const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version;
  return { version, build: build() };
}
module.exports = { info };
if (require.main === module) console.log(JSON.stringify(info()));
