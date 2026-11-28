#!/usr/bin/env node
// Bump the version in one step, from what actually changed.
//   npm run release            -> works out the bump from the commits since the last release (feat = minor, "!"/BREAKING = major, everything else = patch)
//   npm run release -- minor   -> force patch | minor | major
//   npm run release -- --dry   -> only show what would happen
// Updates package.json + package-lock.json, adds a section to CHANGELOG.md, and commits "release vX.Y.Z" (use --no-commit to leave that to you).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const dry = args.includes('--dry'), noCommit = args.includes('--no-commit');
const force = args.find((a) => ['patch', 'minor', 'major'].includes(a));

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// The previous release = the last commit that changed the "version" line of package.json.
let since = '';
try { since = git('log', '-1', '--format=%H', '-G', '^  "version"', '--', 'package.json'); } catch {}
const subjects = (since ? git('log', `${since}..HEAD`, '--format=%s', '--no-merges') : git('log', '--format=%s', '--no-merges')).split('\n').filter((s) => s && !/^release v\d/.test(s) && !/^Merge /.test(s));
if (!subjects.length && !force) { console.log('Nothing to release: no new commits since the last version change.'); process.exit(0); }

const kind = (s) => (/^[a-z]+(\([^)]*\))?!:|BREAKING/.test(s) ? 'major' : /^feat(\(|:)/i.test(s) ? 'minor' : 'patch');
const rank = { patch: 0, minor: 1, major: 2 };
const auto = subjects.map(kind).reduce((a, b) => (rank[b] > rank[a] ? b : a), 'patch');
const bump = force || auto;
let [maj, min, pat] = pkg.version.split('.').map(Number);
if (bump === 'major') { maj++; min = 0; pat = 0; } else if (bump === 'minor') { min++; pat = 0; } else pat++;
const next = `${maj}.${min}.${pat}`;

const group = { Features: [], Fixes: [], Other: [] };
for (const s of subjects) (/^feat/i.test(s) ? group.Features : /^fix/i.test(s) ? group.Fixes : group.Other).push(s.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, ''));
const date = new Date().toISOString().slice(0, 10);
const section = `## ${next} (${date})\n\n` + Object.entries(group).filter(([, v]) => v.length).map(([k, v]) => `### ${k}\n${v.map((x) => `- ${x}`).join('\n')}`).join('\n\n') + '\n\n';

console.log(`${pkg.version} -> ${next} (${force ? 'forced ' : 'from the commits: '}${bump}), ${subjects.length} commit${subjects.length === 1 ? '' : 's'}`);
if (dry) { console.log('\n' + section); process.exit(0); }

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) { const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); lock.version = next; if (lock.packages?.['']) lock.packages[''].version = next; fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n'); }
const logPath = path.join(root, 'CHANGELOG.md');
const old = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').replace(/^# Changelog\s*/, '') : '';
fs.writeFileSync(logPath, `# Changelog\n\n${section}${old}`);
if (!noCommit) { git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md'); git('commit', '-m', `release v${next}`); console.log(`Committed "release v${next}".`); }
else console.log('Files updated. Commit them yourself.');
