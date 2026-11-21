// Builds hosted/content.db: the tutorial (all sprint .md files) with no personal state.
// The hosted server copies this file for every request and fills in the signed-in person's progress.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, setMeta } from '../server/db.js';
import { importFiles, readContentDir } from '../server/importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'hosted/content.db');
for (const f of [out, out + '-wal', out + '-shm']) fs.rmSync(f, { force: true });
const db = openDb(out);
const files = readContentDir(path.join(root, 'content'));
if (!files.length) { console.error('No sprint-*.md files in content/'); process.exit(1); }
const r = importFiles(db, files);
db.exec('DELETE FROM activity; DELETE FROM step_versions;');
setMeta(db, 'badges_seeded', 'hosted');      // nobody inherits "already earned" badges
setMeta(db, 'm_status_done_v2', 'hosted');   // the local-only upgrade step does not apply
db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; VACUUM;');
db.close();
for (const f of [out + '-wal', out + '-shm']) fs.rmSync(f, { force: true });
console.log(`hosted/content.db: ${r.sprints} sprints, ${r.tickets.added} sections, ${r.steps.added} steps, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
