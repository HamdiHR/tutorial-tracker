// Bulk progress operations, per-ticket status changes, and the one-time migration of old "Done" overrides.
// Rule: a ticket that is Done always has all of its steps ticked, so every counter agrees.
import { tx, log, getMeta, setMeta } from './db.js';

const CHECKABLE = `('step','verify')`;
const marks = (a) => a.map(() => '?').join(',');

/** Ticket ids (real, non-deferred tickets) a bulk request applies to. */
export function resolveTargets(db, { all, sprintIds, ticketIds } = {}) {
  const base = `SELECT id FROM tickets WHERE kind='ticket' AND deferred=0 AND orphan=0`;
  if (all) return db.prepare(base).all().map((r) => r.id);
  const out = new Set();
  if (Array.isArray(sprintIds) && sprintIds.length) {
    for (const r of db.prepare(`${base} AND sprint_id IN (${marks(sprintIds)})`).all(...sprintIds.map(String))) out.add(r.id);
  }
  if (Array.isArray(ticketIds) && ticketIds.length) {
    for (const r of db.prepare(`${base} AND id IN (${marks(ticketIds)})`).all(...ticketIds.map(String))) out.add(r.id);
  }
  return [...out];
}

const stepsNeedingChange = (db, ticketIds, to) =>
  ticketIds.length
    ? db
        .prepare(`SELECT id FROM steps WHERE ticket_id IN (${marks(ticketIds)}) AND kind IN ${CHECKABLE} AND orphan=0 AND done<>?`)
        .all(...ticketIds, to)
        .map((r) => r.id)
    : [];

function setSteps(db, ids, to) {
  const upd = db.prepare(`UPDATE steps SET done=?, done_at=CASE WHEN ?=1 THEN datetime('now') END WHERE id=?`);
  for (const id of ids) upd.run(to, to, id);
}

/**
 * action: 'done' (tick every step, clear overrides) | 'reset' (untick every step, clear overrides).
 * Returns what changed plus an `undo` payload that restores it exactly.
 */
export function bulk(db, action, targets, { dryRun = false } = {}) {
  if (action !== 'done' && action !== 'reset') throw new Error('action must be "done" or "reset"');
  const to = action === 'done' ? 1 : 0;
  const ids = resolveTargets(db, targets);
  const changed = stepsNeedingChange(db, ids, to);
  if (dryRun) return { tickets: ids.length, steps: changed.length };

  const overrides = {};
  tx(db, () => {
    for (const r of ids.length ? db.prepare(`SELECT id, status_override ov FROM tickets WHERE id IN (${marks(ids)}) AND status_override IS NOT NULL`).all(...ids) : []) overrides[r.id] = r.ov;
    setSteps(db, changed, to);
    if (ids.length) db.prepare(`UPDATE tickets SET status_override=NULL WHERE id IN (${marks(ids)})`).run(...ids);
    log(db, 'bulk', null, null, JSON.stringify({ action, tickets: ids.length, steps: changed.length }));
  });
  return { tickets: ids.length, steps: changed.length, undo: { changed, to: 1 - to, overrides } };
}

export function undoBulk(db, { changed, to, overrides }) {
  if (!Array.isArray(changed) || (to !== 0 && to !== 1)) throw new Error('Invalid undo payload');
  const ids = changed.filter(Number.isInteger);
  tx(db, () => {
    setSteps(db, ids, to);
    for (const [tid, st] of Object.entries(overrides || {})) db.prepare('UPDATE tickets SET status_override=? WHERE id=?').run(st, tid);
    log(db, 'bulk', null, null, JSON.stringify({ action: 'undo', steps: ids.length }));
  });
  return { steps: ids.length };
}

/**
 * Per-ticket status. 'done' ticks every step, 'todo' unticks them (both clear the override);
 * 'pending' / 'doing' / 'test' / 'blocked' are labels (steps untouched); null = automatic.
 */
export function applyTicketStatus(db, ticketId, status) {
  let changed = [];
  let to = null;
  const prev = db.prepare('SELECT status_override ov FROM tickets WHERE id=?').get(ticketId)?.ov ?? null;
  tx(db, () => {
    if (status === 'done' || status === 'todo') {
      to = status === 'done' ? 1 : 0;
      changed = stepsNeedingChange(db, [ticketId], to);
      setSteps(db, changed, to);
      db.prepare('UPDATE tickets SET status_override=NULL WHERE id=?').run(ticketId);
      if (changed.length) log(db, 'bulk', ticketId, null, JSON.stringify({ action: status, steps: changed.length }));
    } else if (status === 'pending') {
      // "Pending" keeps the ticked steps (nothing is lost); with no ticked step it is simply automatic.
      const n = db.prepare(`SELECT count(*) n FROM steps WHERE ticket_id=? AND kind IN ${CHECKABLE} AND orphan=0 AND done=1`).get(ticketId).n;
      db.prepare('UPDATE tickets SET status_override=? WHERE id=?').run(n ? 'todo' : null, ticketId);
    } else {
      db.prepare('UPDATE tickets SET status_override=? WHERE id=?').run(status, ticketId);
    }
  });
  const undo = to === null ? null : { changed, to: 1 - to, overrides: prev ? { [ticketId]: prev } : {} };
  return { changed, undo };
}

/**
 * One-time: older versions let a ticket be marked Done without ticking its steps, which made the
 * overall progress disagree with the tickets. Tick the steps of those tickets and drop the override.
 */
export function migrateStatusOverrides(db) {
  if (getMeta(db, 'm_status_done_v2')) return 0;
  const ids = db.prepare(`SELECT id FROM tickets WHERE status_override='done'`).all().map((r) => r.id);
  tx(db, () => {
    setSteps(db, stepsNeedingChange(db, ids, 1), 1);
    if (ids.length) db.prepare(`UPDATE tickets SET status_override=NULL WHERE id IN (${marks(ids)})`).run(...ids);
    setMeta(db, 'm_status_done_v2', new Date().toISOString());
  });
  return ids.length;
}
