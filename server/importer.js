import fs from 'node:fs';
import path from 'node:path';
import { parseSprintFile, buildMarkdown, normalise } from './parse.js';
import { mergeParsed, sectionsForSprint } from './db.js';

export function readContentDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^sprint-.*\.md$/i.test(f))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

/** files: [{name, text}] */
export function importFiles(db, files) {
  const parsed = files.map((f) => parseSprintFile(f.name, f.text));
  return mergeParsed(db, parsed);
}

export function exportSprintMarkdown(db, sprintId) {
  const data = sectionsForSprint(db, sprintId);
  if (!data) return null;
  return { file: data.sprint.file, text: buildMarkdown(data.sprint.head, data.sections) };
}

export function exportAllToDir(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const s of db.prepare('SELECT id FROM sprints ORDER BY ord').all()) {
    const out = exportSprintMarkdown(db, s.id);
    fs.writeFileSync(path.join(dir, out.file), out.text, 'utf8');
    written.push(out.file);
  }
  return written;
}

export { normalise };
