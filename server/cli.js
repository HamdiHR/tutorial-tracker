// node server/cli.js import [dir]   -> merge .md files into the database (default: ./content)
// node server/cli.js export [dir]   -> write the current content back to .md files (default: ./export)
import { openDb, backupDb } from './db.js';
import { loadConfig } from './index.js';
import { importFiles, readContentDir, exportAllToDir } from './importer.js';
import path from 'node:path';

const [cmd, arg] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg.dbPath);

if (cmd === 'import') {
  const dir = path.resolve(arg || cfg.contentDir);
  const files = readContentDir(dir);
  if (!files.length) {
    console.error(`No sprint-*.md files in ${dir}`);
    process.exit(1);
  }
  backupDb(db, cfg.dataDir);
  console.log(JSON.stringify(importFiles(db, files), null, 2));
} else if (cmd === 'export') {
  const dir = path.resolve(arg || cfg.exportDir);
  console.log(`Wrote ${exportAllToDir(db, dir).length} files to ${dir}`);
} else {
  console.log('Usage: node server/cli.js import|export [dir]');
  process.exit(cmd ? 1 : 0);
}
