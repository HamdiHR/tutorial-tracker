// The hosted app reuses the tested local engine (server/api.js) on a throwaway SQLite copy of the tutorial,
// filled with ONE person's saved state, and writes back only what changed. This file does the filling
// (hydrate), the reading-back (extract) and the comparison (diff). Pure functions, no network.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncDrift, reindexStep } from '../server/db.js';

const toSql = (iso) => (iso ? new Date(iso).toISOString().slice(0, 19).replace('T', ' ') : null); // Postgres -> sqlite (UTC)
const toIso = (s) => (s ? s.replace(' ', 'T') + 'Z' : null); // sqlite (UTC) -> Postgres
const PERSIST_META = ['plan', 'resume'];
const persists = (k) => PERSIST_META.includes(k) || k.startsWith('tk:') || k === 'ui:views'; // tk:<ticket> = priority, labels, subtasks, files

/** Copy the shipped, read-only content DB to a private working file and open it. */
export function openWorking(templatePath) {
  const file = path.join(os.tmpdir(), `tt-${randomUUID()}.db`);
  fs.copyFileSync(templatePath, file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;');
  return { db, close() { try { db.close(); } catch {} for (const f of [file, file + '-journal', file + '-wal', file + '-shm']) fs.rmSync(f, { force: true }); } };
}

/** Put a person's saved state (the tt_state() JSON) on top of the pristine tutorial. */
export function hydrate(db, st) {
  const stepId = db.prepare('SELECT id FROM steps WHERE ticket_id=? AND key=?');
  const idOf = (t, k) => stepId.get(t, k)?.id;
  const touched = new Set();
  db.exec('BEGIN');
  try {
    const upStep = db.prepare('UPDATE steps SET done=?, done_at=?, note=?, title=COALESCE(?,title), body=COALESCE(?,body) WHERE id=?');
    for (const s of st.steps || []) {
      const id = idOf(s.t, s.k);
      if (id == null) continue;
      upStep.run(s.done ? 1 : 0, toSql(s.done_at), s.note || '', s.title ?? null, s.body ?? null, id);
      if (s.title != null || s.body != null || s.note) touched.add(id);
    }
    const upTicket = db.prepare('UPDATE tickets SET status_override=?, note=? WHERE id=?');
    for (const t of st.tickets || []) upTicket.run(t.ov ?? null, t.note || '', t.t);
    const insVer = db.prepare('INSERT INTO step_versions (step_id, ts, title, body, label) VALUES (?,?,?,?,?)');
    for (const v of st.versions || []) { const id = idOf(v.t, v.k); if (id != null) insVer.run(id, toSql(v.ts), v.title, v.body, v.label || 'edit'); }
    const insAct = db.prepare('INSERT INTO activity (ts, type, ticket_id, step_id, info) VALUES (?,?,?,?,?)');
    for (const a of st.activity || []) insAct.run(toSql(a.ts), a.type, a.t ?? null, a.k ? idOf(a.t, a.k) ?? null : null, a.info ?? null);
    const insBadge = db.prepare('INSERT OR IGNORE INTO badge_unlocks (key, family, tier, unlocked_at) VALUES (?,?,?,?)');
    for (const b of st.badges || []) insBadge.run(b.key, b.family, b.tier, toSql(b.at));
    const setMeta = db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(st.meta || {})) if (persists(k)) setMeta.run(k, v);
    for (const id of touched) { syncDrift(db, id); reindexStep(db, id); } // edited text may carry 🔍 lines; notes are searchable
    const upDrift = db.prepare('UPDATE drift SET state=?, note=? WHERE hash=? AND step_id=?');
    for (const d of st.drift || []) { const id = idOf(d.t, d.k); if (id != null) upDrift.run(d.state, d.note || '', d.h, id); }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const j = (o) => JSON.stringify(o);

/** Everything about the person that differs from the pristine tutorial, as plain maps. */
export function extract(db) {
  const steps = new Map();
  for (const r of db.prepare(`SELECT ticket_id t, key k, done, done_at, note, title, body, orig_title, orig_body FROM steps WHERE done=1 OR note<>'' OR title<>orig_title OR body<>orig_body`).all()) {
    steps.set(`${r.t}|${r.k}`, { t: r.t, k: r.k, done: !!r.done, done_at: toIso(r.done_at), note: r.note, title: r.title !== r.orig_title ? r.title : null, body: r.body !== r.orig_body ? r.body : null });
  }
  const tickets = new Map();
  for (const r of db.prepare(`SELECT id t, status_override ov, note FROM tickets WHERE status_override IS NOT NULL OR note<>''`).all()) tickets.set(r.t, { t: r.t, ov: r.ov, note: r.note });
  const drift = new Map();
  for (const r of db.prepare(`SELECT s.ticket_id t, s.key k, d.hash h, d.state, d.note FROM drift d JOIN steps s ON s.id=d.step_id WHERE d.state<>'open' OR d.note<>''`).all()) drift.set(`${r.t}|${r.k}|${r.h}`, { t: r.t, k: r.k, h: r.h, state: r.state, note: r.note });
  const meta = new Map();
  for (const r of db.prepare('SELECT key, value FROM meta').all()) if (persists(r.key)) meta.set(r.key, r.value);
  const badges = new Set(db.prepare('SELECT key FROM badge_unlocks').all().map((r) => r.key));
  return {
    steps, tickets, drift, meta, badges,
    maxActivity: db.prepare('SELECT coalesce(max(id),0) n FROM activity').get().n,
    maxVersion: db.prepare('SELECT coalesce(max(id),0) n FROM step_versions').get().n,
  };
}

/** What to send to tt_apply so the database matches `after`. Returns null when nothing changed. */
export function diff(db, before, after) {
  const out = { steps: { set: [], del: [] }, tickets: { set: [], del: [] }, drift: { set: [], del: [] }, meta: { set: {}, del: [] } };
  let n = 0;
  const walk = (a, b, set, del, same = (x, y) => j(x) === j(y)) => {
    for (const [k, v] of b) if (!a.has(k) || !same(a.get(k), v)) { set(k, v); n++; }
    for (const [k, v] of a) if (!b.has(k)) { del(k, v); n++; }
  };
  walk(before.steps, after.steps, (_, v) => out.steps.set.push(v), (_, v) => out.steps.del.push({ t: v.t, k: v.k }));
  walk(before.tickets, after.tickets, (_, v) => out.tickets.set.push(v), (k) => out.tickets.del.push(k));
  walk(before.drift, after.drift, (_, v) => out.drift.set.push(v), (_, v) => out.drift.del.push({ t: v.t, k: v.k, h: v.h }));
  walk(before.meta, after.meta, (k, v) => (out.meta.set[k] = v), (k) => out.meta.del.push(k));

  const stepKey = db.prepare('SELECT ticket_id t, key k FROM steps WHERE id=?');
  const keyOf = (id) => (id == null ? null : stepKey.get(id));
  out.activity = db.prepare('SELECT ts, type, ticket_id, step_id, info FROM activity WHERE id>? ORDER BY id').all(before.maxActivity).map((a) => {
    const s = keyOf(a.step_id);
    return { ts: toIso(a.ts), type: a.type, t: a.ticket_id, k: s?.k ?? null, info: a.info };
  });
  const vers = db.prepare('SELECT step_id, ts, title, body, label FROM step_versions WHERE id>? ORDER BY id').all(before.maxVersion);
  out.versions = vers.map((v) => ({ ...keyOf(v.step_id), ts: toIso(v.ts), title: v.title, body: v.body, label: v.label }));
  out.prune_versions = [...new Set(out.versions.map((v) => `${v.t}|${v.k}`))].map((s) => { const [t, k] = s.split('|'); return { t, k }; });
  const fresh = db.prepare('SELECT key, family, tier FROM badge_unlocks').all().filter((b) => !before.badges.has(b.key));
  out.badges = fresh;
  n += out.activity.length + out.versions.length + fresh.length;
  return n ? out : null;
}
