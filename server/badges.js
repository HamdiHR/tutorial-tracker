// Achievements, XP and levels. Everything is derived from your data; only the moment a badge was
// first earned is stored (so it is celebrated once and never taken away).
import { getMeta, setMeta } from './db.js';

const CHECKABLE = `('step','verify')`;
export const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];

export const FAMILIES = [
  { id: 'steps', title: 'Step Climber', icon: '🧗', stat: 'steps', unit: 'steps completed', blurb: 'Complete steps in your tutorials.', tiers: [1, 25, 100, 250, 500] },
  { id: 'tickets', title: 'Ticket Crusher', icon: '🎫', stat: 'tickets', unit: 'tickets finished', blurb: 'Finish whole tickets.', tiers: [1, 10, 50, 100] },
  { id: 'sprints', title: 'Sprint Finisher', icon: '🏁', stat: 'sprints', unit: 'sprints completed', blurb: 'Complete every ticket of a sprint.', tiers: [1, 3, 6, 9] },
  { id: 'milestone', title: 'Road to Done', icon: '🏔️', stat: 'pct', unit: '% of the course', blurb: 'Overall progress across all sprints.', tiers: [25, 50, 75, 100] },
  { id: 'streak', title: 'Streak Keeper', icon: '🔥', stat: 'bestStreak', unit: 'day streak', blurb: 'Complete at least one step on consecutive days.', tiers: [3, 7, 14, 30] },
  { id: 'focus', title: 'Deep Focus', icon: '🎯', stat: 'bestDay', unit: 'steps in a single day', blurb: 'Your best day of work.', tiers: [5, 10, 20, 40] },
  { id: 'fixes', title: 'Fixer', icon: '🛠️', stat: 'edits', unit: 'slides fixed', blurb: 'Correct or improve the tutorial text.', tiers: [1, 10, 30] },
  { id: 'notes', title: 'Note Taker', icon: '📝', stat: 'notes', unit: 'notes written', blurb: 'Write notes on slides or tickets.', tiers: [1, 5, 20] },
  { id: 'drift', title: 'Doc Detective', icon: '🔍', stat: 'driftResolved', unit: 'drift items resolved', blurb: 'Verify the “Verify against docs” spots.', tiers: [1, 10, 50] },
  { id: 'inbox', title: 'Inbox Zero', icon: '📭', stat: 'inboxZero', unit: 'empty drift inbox', blurb: 'Resolve every item in the Drift inbox.', tiers: [1] },
];

const dayKey = (d) => d.toISOString().slice(0, 10);

/** Longest run of consecutive days in a sorted list of 'YYYY-MM-DD'. */
function longestRun(days) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    const t = Date.parse(d + 'T00:00:00Z');
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    prev = t;
    best = Math.max(best, run);
  }
  return best;
}

export function computeStats(db) {
  const tickets = db
    .prepare(
      `SELECT t.id, t.sprint_id, t.status_override ov, count(s.id) total, coalesce(sum(s.done),0) done
       FROM tickets t LEFT JOIN steps s ON s.ticket_id=t.id AND s.kind IN ${CHECKABLE} AND s.orphan=0
       WHERE t.kind='ticket' AND t.deferred=0 AND t.orphan=0 GROUP BY t.id`,
    )
    .all();
  const isDone = (t) => t.ov === 'done' || (!t.ov && t.total > 0 && t.done >= t.total);
  const bySprint = new Map();
  for (const t of tickets) {
    const s = bySprint.get(t.sprint_id) || { total: 0, done: 0 };
    s.total++;
    if (isDone(t)) s.done++;
    bySprint.set(t.sprint_id, s);
  }
  const steps = tickets.reduce((a, t) => a + t.done, 0);
  const stepsTotal = tickets.reduce((a, t) => a + t.total, 0);
  const days = db.prepare(`SELECT date(ts,'localtime') d, count(*) n FROM activity WHERE type='done' GROUP BY d ORDER BY d`).all();
  const drift = db.prepare(`SELECT count(*) total, coalesce(sum(state<>'open'),0) resolved FROM drift`).get();
  return {
    steps,
    stepsTotal,
    tickets: tickets.filter(isDone).length,
    ticketsTotal: tickets.length,
    sprints: [...bySprint.values()].filter((s) => s.total > 0 && s.done >= s.total).length,
    completeSprints: [...bySprint.entries()].filter(([, s]) => s.total > 0 && s.done >= s.total).map(([id]) => id),
    sprintProgress: Object.fromEntries([...bySprint.entries()].map(([id, s]) => [id, s])),
    pct: stepsTotal ? Math.floor((steps / stepsTotal) * 100) : 0,
    bestStreak: longestRun(days.map((d) => d.d)),
    bestDay: days.reduce((m, d) => Math.max(m, d.n), 0),
    edits: db.prepare(`SELECT count(*) n FROM activity WHERE type='edit' AND info='edit'`).get().n,
    notes: db.prepare(`SELECT (SELECT count(*) FROM steps WHERE note<>'') + (SELECT count(*) FROM tickets WHERE note<>'') n`).get().n,
    driftResolved: drift.resolved,
    inboxZero: drift.total > 0 && drift.resolved >= drift.total ? 1 : 0,
  };
}

export function xpOf(s) {
  return s.steps * 10 + s.tickets * 50 + s.sprints * 250 + s.edits * 10 + s.notes * 5 + s.driftResolved * 5;
}

const levelStart = (l) => 50 * l * (l - 1);
export function playerOf(stats) {
  const xp = xpOf(stats);
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
  const title = level < 3 ? 'Rookie' : level < 5 ? 'Builder' : level < 8 ? 'Engineer' : level < 12 ? 'Architect' : 'Master';
  return { xp, level, title, levelStart: levelStart(level), levelNext: levelStart(level + 1) };
}

/** Everything the achievements page needs. */
export function evaluate(db) {
  const stats = computeStats(db);
  const unlocked = new Map(db.prepare('SELECT key, unlocked_at FROM badge_unlocks').all().map((r) => [r.key, r.unlocked_at]));
  let unlockedCount = 0;
  let totalCount = 0;
  const badges = FAMILIES.map((f) => {
    const value = stats[f.stat];
    const tiers = f.tiers.map((n, i) => {
      const at = unlocked.get(`${f.id}:${i + 1}`) || null;
      const ok = !!at || value >= n;
      totalCount++;
      if (ok) unlockedCount++;
      return { n, name: TIER_NAMES[i], unlocked: ok, at };
    });
    const next = f.tiers.find((n) => value < n) ?? null;
    return { id: f.id, title: f.title, icon: f.icon, unit: f.unit, blurb: f.blurb, value, tiers, reached: tiers.filter((t) => t.unlocked).length, next };
  });
  const sprints = db.prepare('SELECT id, title FROM sprints ORDER BY ord').all();
  const trophies = sprints.map((sp) => {
    const prog = stats.sprintProgress[sp.id] || { total: 0, done: 0 };
    const at = unlocked.get(`sprint:${sp.id}`) || null;
    const complete = !!at || stats.completeSprints.includes(sp.id);
    totalCount++;
    if (complete) unlockedCount++;
    return { sprintId: sp.id, title: sp.title, complete, at, done: prog.done, total: prog.total };
  });
  return { player: { ...playerOf(stats), unlocked: unlockedCount, total: totalCount }, stats, badges, trophies };
}

/** Persist newly reached badges and return them (so the UI can celebrate each one exactly once). */
export function award(db) {
  const stats = computeStats(db);
  const have = new Set(db.prepare('SELECT key FROM badge_unlocks').all().map((r) => r.key));
  const fresh = [];
  for (const f of FAMILIES) {
    f.tiers.forEach((n, i) => {
      const key = `${f.id}:${i + 1}`;
      if (stats[f.stat] >= n && !have.has(key)) fresh.push({ key, family: f.id, tier: i + 1, kind: 'badge', title: f.title, icon: f.icon, tierName: TIER_NAMES[i], detail: `${n} ${f.unit}` });
    });
  }
  const titles = new Map(db.prepare('SELECT id, title FROM sprints').all().map((s) => [s.id, s.title]));
  for (const id of stats.completeSprints) {
    const key = `sprint:${id}`;
    if (!have.has(key)) fresh.push({ key, family: 'sprint', tier: 1, kind: 'sprint', sprintId: id, title: `Sprint ${id} complete`, icon: '🏆', tierName: 'Trophy', detail: titles.get(id) || '' });
  }
  const ins = db.prepare('INSERT OR IGNORE INTO badge_unlocks (key, family, tier) VALUES (?,?,?)');
  for (const b of fresh) ins.run(b.key, b.family, b.tier);
  return fresh;
}

/** First start after an upgrade: record what you had already earned without celebrating it. */
export function seedBadges(db) {
  if (getMeta(db, 'badges_seeded')) return 0;
  const n = award(db).length;
  setMeta(db, 'badges_seeded', new Date().toISOString());
  return n;
}

export { dayKey };
