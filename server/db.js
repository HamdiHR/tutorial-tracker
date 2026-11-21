import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY, ord REAL NOT NULL, title TEXT NOT NULL, file TEXT NOT NULL, head TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- 'ticket' | 'ref'
  title TEXT NOT NULL,
  heading_raw TEXT NOT NULL,
  deferred INTEGER NOT NULL DEFAULT 0,
  status_override TEXT,               -- NULL = derive from steps
  note TEXT NOT NULL DEFAULT '',
  orphan INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tickets_sprint ON tickets(sprint_id, ord);

CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- 'intro' | 'step' | 'verify' | 'ref'
  title TEXT NOT NULL,
  orig_title TEXT NOT NULL,
  heading_raw TEXT,
  lead TEXT NOT NULL DEFAULT '[]',    -- JSON array of blank lines before the body (round-trip padding)
  tail TEXT NOT NULL DEFAULT '[]',    -- JSON array of blank / '---' lines after the body
  orig_body TEXT NOT NULL,
  body TEXT NOT NULL,
  upstream_body TEXT,                 -- set when the md file changed under an edited step
  upstream_title TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  orphan INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ticket_id, key)
);
CREATE INDEX IF NOT EXISTS steps_ticket ON steps(ticket_id, ord);

CREATE TABLE IF NOT EXISTS step_versions (
  id INTEGER PRIMARY KEY, step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  ts TEXT NOT NULL DEFAULT (datetime('now')), title TEXT NOT NULL, body TEXT NOT NULL, label TEXT NOT NULL DEFAULT 'edit'
);
CREATE INDEX IF NOT EXISTS versions_step ON step_versions(step_id, id);

CREATE TABLE IF NOT EXISTS drift (
  id INTEGER PRIMARY KEY, step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  hash TEXT NOT NULL, line TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open',  -- open | checked | fixed | wrong
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (step_id, hash)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,                  -- done | undone | edit | note | reset | import
  ticket_id TEXT, step_id INTEGER, info TEXT
);
CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts);

CREATE TABLE IF NOT EXISTS badge_unlocks (
  key TEXT PRIMARY KEY, family TEXT NOT NULL, tier INTEGER NOT NULL, unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS steps_fts USING fts5(title, body, note, ticket, tokenize = 'unicode61 remove_diacritics 2');
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

/** Keep the last N snapshots of the database (VACUUM INTO is WAL-safe). */
export function backupDb(db, dataDir, keep = 5) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const target = path.join(dir, `tutorial-${stamp}.db`);
  if (!fs.existsSync(target)) db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(dir).filter((f) => /^tutorial-.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  return target;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const log = (db, type, ticketId = null, stepId = null, info = null) =>
  db.prepare('INSERT INTO activity (type, ticket_id, step_id, info) VALUES (?,?,?,?)').run(type, ticketId, stepId, info);

export const getMeta = (db, key) => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? null;
export const setMeta = (db, key, value) =>
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);

// ---------------------------------------------------------------- search index + drift

export function reindexStep(db, stepId) {
  db.prepare('DELETE FROM steps_fts WHERE rowid = ?').run(stepId);
  const r = db
    .prepare(
      `SELECT s.id, s.title, s.body, s.note, t.id || ' ' || t.title AS ticket
       FROM steps s JOIN tickets t ON t.id = s.ticket_id WHERE s.id = ?`,
    )
    .get(stepId);
  if (r) db.prepare('INSERT INTO steps_fts (rowid, title, body, note, ticket) VALUES (?,?,?,?,?)').run(r.id, r.title, r.body, r.note, r.ticket);
}

export function reindexAll(db) {
  db.exec('DELETE FROM steps_fts');
  db.exec(`INSERT INTO steps_fts (rowid, title, body, note, ticket)
           SELECT s.id, s.title, s.body, s.note, t.id || ' ' || t.title FROM steps s JOIN tickets t ON t.id = s.ticket_id`);
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Re-scan a step's body for 🔍 lines; keep your state for lines that are still there. */
export function syncDrift(db, stepId) {
  const step = db.prepare('SELECT body FROM steps WHERE id=?').get(stepId);
  if (!step) return;
  const found = new Map();
  step.body.split('\n').forEach((line, i) => {
    if (!line.includes('🔍')) return;
    const text = line.replace(/^[\s>]+/, '').trim().slice(0, 500);
    const h = hash(text);
    if (!found.has(h)) found.set(h, { text, pos: i });
  });
  const existing = db.prepare('SELECT id, hash, state FROM drift WHERE step_id=?').all(stepId);
  for (const e of existing) {
    if (!found.has(e.hash) && e.state === 'open') db.prepare('DELETE FROM drift WHERE id=?').run(e.id);
  }
  for (const [h, f] of found) {
    db.prepare(
      `INSERT INTO drift (step_id, hash, line, pos) VALUES (?,?,?,?)
       ON CONFLICT(step_id, hash) DO UPDATE SET line = excluded.line, pos = excluded.pos`,
    ).run(stepId, h, f.text, f.pos);
  }
}

// ---------------------------------------------------------------- import / merge

const j = (a) => JSON.stringify(a);

/**
 * Merge parsed sprint files into the DB.
 * Unedited steps follow the new text; edited steps keep your text and get `upstream_body` for review.
 * Progress, notes, edits and drift states are never lost.
 */
export function mergeParsed(db, parsedFiles) {
  const report = { sprints: 0, tickets: { added: 0, updated: 0 }, steps: { added: 0, updated: 0, flagged: 0, orphaned: 0, removed: 0 } };

  tx(db, () => {
    const upSprint = db.prepare(
      `INSERT INTO sprints (id, ord, title, file, head) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET ord=excluded.ord, title=excluded.title, file=excluded.file, head=excluded.head`,
    );
    const getTicket = db.prepare('SELECT id FROM tickets WHERE id=?');
    const insTicket = db.prepare(
      `INSERT INTO tickets (id, sprint_id, ord, kind, title, heading_raw, deferred) VALUES (?,?,?,?,?,?,?)`,
    );
    const updTicket = db.prepare(
      `UPDATE tickets SET sprint_id=?, ord=?, kind=?, title=?, heading_raw=?, deferred=?, orphan=0 WHERE id=?`,
    );
    const getSteps = db.prepare('SELECT * FROM steps WHERE ticket_id=?');
    const insStep = db.prepare(
      `INSERT INTO steps (ticket_id, key, ord, kind, title, orig_title, heading_raw, lead, tail, orig_body, body)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const updFollow = db.prepare(
      `UPDATE steps SET ord=?, kind=?, title=?, orig_title=?, heading_raw=?, lead=?, tail=?, orig_body=?, body=?,
              upstream_body=NULL, upstream_title=NULL, orphan=0 WHERE id=?`,
    );
    const updEdited = db.prepare(
      `UPDATE steps SET ord=?, kind=?, lead=?, tail=?, upstream_body=?, upstream_title=?, orphan=0 WHERE id=?`,
    );
    const acceptSame = db.prepare(
      `UPDATE steps SET ord=?, kind=?, lead=?, tail=?, orig_body=?, orig_title=?, upstream_body=NULL, upstream_title=NULL, orphan=0 WHERE id=?`,
    );
    const delStep = db.prepare('DELETE FROM steps WHERE id=?');
    const orphanStep = db.prepare('UPDATE steps SET orphan=1 WHERE id=?');

    for (const { sprint, sections } of parsedFiles) {
      report.sprints++;
      upSprint.run(sprint.id, sprint.ord, sprint.title, sprint.file, sprint.head);
      const seenTickets = new Set();

      sections.forEach((sec, tIdx) => {
        seenTickets.add(sec.id);
        if (getTicket.get(sec.id)) {
          updTicket.run(sprint.id, tIdx, sec.kind, sec.title, sec.headingRaw, sec.deferred, sec.id);
          report.tickets.updated++;
        } else {
          insTicket.run(sec.id, sprint.id, tIdx, sec.kind, sec.title, sec.headingRaw, sec.deferred);
          report.tickets.added++;
        }

        const existing = new Map(getSteps.all(sec.id).map((s) => [s.key, s]));
        const seen = new Set();
        sec.steps.forEach((st, sIdx) => {
          seen.add(st.key);
          const ex = existing.get(st.key);
          if (!ex) {
            const r = insStep.run(sec.id, st.key, sIdx, st.kind, st.title, st.title, st.headingRaw, j(st.lead), j(st.tail), st.body, st.body);
            syncDrift(db, Number(r.lastInsertRowid));
            report.steps.added++;
            return;
          }
          const edited = ex.body !== ex.orig_body || ex.title !== ex.orig_title;
          if (!edited) {
            if (ex.body !== st.body || ex.title !== st.title || ex.ord !== sIdx || ex.lead !== j(st.lead) || ex.tail !== j(st.tail) || ex.orphan) {
              if (ex.body !== st.body || ex.title !== st.title) report.steps.updated++;
              updFollow.run(sIdx, st.kind, st.title, st.title, st.headingRaw, j(st.lead), j(st.tail), st.body, st.body, ex.id);
              syncDrift(db, ex.id);
            }
          } else if (st.body === ex.body && st.title === ex.title) {
            acceptSame.run(sIdx, st.kind, j(st.lead), j(st.tail), st.body, st.title, ex.id);
          } else if (st.body !== ex.orig_body || st.title !== ex.orig_title) {
            if (ex.upstream_body !== st.body) report.steps.flagged++;
            updEdited.run(sIdx, st.kind, j(st.lead), j(st.tail), st.body, st.title, ex.id);
          } else {
            updEdited.run(sIdx, st.kind, j(st.lead), j(st.tail), null, null, ex.id);
          }
        });

        for (const [key, ex] of existing) {
          if (seen.has(key)) continue;
          const touched = ex.done || ex.note || ex.body !== ex.orig_body;
          if (touched) {
            orphanStep.run(ex.id);
            report.steps.orphaned++;
          } else {
            db.prepare('DELETE FROM steps_fts WHERE rowid=?').run(ex.id);
            delStep.run(ex.id);
            report.steps.removed++;
          }
        }
      });

      // tickets that vanished from this file: keep (they may hold progress), flag as orphan
      const inDb = db.prepare('SELECT id FROM tickets WHERE sprint_id=?').all(sprint.id);
      for (const t of inDb) if (!seenTickets.has(t.id)) db.prepare('UPDATE tickets SET orphan=1 WHERE id=?').run(t.id);
    }

    reindexAll(db);
    log(db, 'import', null, null, JSON.stringify(report));
    setMeta(db, 'last_import', new Date().toISOString());
  });
  return report;
}

// ---------------------------------------------------------------- export

export function sectionsForSprint(db, sprintId) {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id=?').get(sprintId);
  if (!sprint) return null;
  const tickets = db.prepare('SELECT * FROM tickets WHERE sprint_id=? AND orphan=0 ORDER BY ord').all(sprintId);
  const steps = db.prepare('SELECT * FROM steps WHERE ticket_id=? AND orphan=0 ORDER BY ord');
  return {
    sprint,
    sections: tickets.map((t) => ({
      headingRaw: t.heading_raw,
      steps: steps.all(t.id).map((s) => ({
        heading_raw: s.heading_raw === null ? null : s.heading_raw.replace(/^(#{2,3}[ \t]+).*$/, (_m, p1) => p1 + s.title),
        lead: JSON.parse(s.lead),
        tail: JSON.parse(s.tail),
        body: s.body,
      })),
    })),
  };
}
