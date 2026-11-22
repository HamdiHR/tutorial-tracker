import fs from 'node:fs';
import path from 'node:path';
import { tx, log, getMeta, setMeta, reindexStep, syncDrift, backupDb } from './db.js';
import { importFiles, readContentDir, exportSprintMarkdown, exportAllToDir } from './importer.js';
import { bulk, undoBulk, applyTicketStatus } from './progress.js';
import { award, evaluate } from './badges.js';
import { cleanPlan, computeSchedule, validDate } from './plan.js';
import { readExtras, writeExtras, normalize, summary as extrasSummary, saveLocalFile, localPath, isInline, KEY as EXTRA_KEY } from './extras.js';

const STATUSES = ['todo', 'doing', 'done', 'blocked', 'test', 'pending'];
// Every progress-changing response carries any newly earned badges and the fresh player card (XP / level),
// so the UI can update in place instead of re-fetching the whole overview.
const withAward = (db, out) => {
  const unlocked = award(db);
  return { ...out, unlocked, player: evaluate(db).player };
};
const CHECKABLE = `('step','verify')`;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

export function deriveStatus(t) {
  if (t.kind === 'ref') return 'ref';
  if (t.deferred) return 'deferred';
  if (t.status_override) return t.status_override;
  if (!t.total) return 'todo';
  if (t.done >= t.total) return 'done';
  return t.done > 0 ? 'doing' : 'todo';
}

const TICKET_ROWS = `
  SELECT t.id, t.sprint_id, t.ord, t.kind, t.title, t.deferred, t.status_override, t.orphan, sp.ord AS sprint_ord,
    (SELECT count(*) FROM steps s WHERE s.ticket_id=t.id AND s.kind IN ${CHECKABLE} AND s.orphan=0) AS total,
    (SELECT count(*) FROM steps s WHERE s.ticket_id=t.id AND s.kind IN ${CHECKABLE} AND s.orphan=0 AND s.done=1) AS done,
    (SELECT count(*) FROM steps s WHERE s.ticket_id=t.id AND (s.note<>'' ) ) + (t.note<>'') AS notes,
    (SELECT count(*) FROM steps s WHERE s.ticket_id=t.id AND (s.body<>s.orig_body OR s.title<>s.orig_title)) AS edits,
    (SELECT count(*) FROM steps s WHERE s.ticket_id=t.id AND s.upstream_body IS NOT NULL) AS upstream
  FROM tickets t JOIN sprints sp ON sp.id = t.sprint_id`;

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function createApi(db, cfg) {
  const q = (sql) => db.prepare(sql);

  function allTickets() {
    return q(`${TICKET_ROWS} WHERE t.orphan=0 ORDER BY sp.ord, t.ord`)
      .all()
      .map((t) => ({ ...t, status: deriveStatus(t) }));
  }

  function resumePointer(tickets) {
    let r = null;
    try {
      r = JSON.parse(getMeta(db, 'resume') || 'null');
    } catch {
      r = null;
    }
    if (r) {
      const t = tickets.find((x) => x.id === r.ticketId);
      const s = q('SELECT id, title FROM steps WHERE id=?').get(r.stepId ?? -1);
      if (t) return { ticketId: t.id, stepId: s?.id ?? null, stepTitle: s?.title ?? null };
    }
    const first = tickets.find((t) => t.kind === 'ticket' && t.status !== 'done' && t.status !== 'deferred');
    return first ? { ticketId: first.id, stepId: null, stepTitle: null } : null;
  }

  /** Minimal live state of one ticket: what the board, sidebar and ticket header need after a change. */
  function ticketSummary(id) {
    const r = q(`${TICKET_ROWS} WHERE t.id=?`).get(id);
    return r ? { id: r.id, status: deriveStatus(r), override: r.status_override, total: r.total, done: r.done } : null;
  }

  function overview() {
    const tickets = allTickets();
    const sprints = q('SELECT id, ord, title FROM sprints ORDER BY ord').all();
    const bySprint = sprints.map((sp) => {
      const items = tickets.filter((t) => t.sprint_id === sp.id);
      const real = items.filter((t) => t.kind === 'ticket' && !t.deferred);
      return {
        ...sp,
        total: real.reduce((a, t) => a + t.total, 0),
        done: real.reduce((a, t) => a + t.done, 0),
        ticketsTotal: real.length,
        ticketsDone: real.filter((t) => t.status === 'done').length,
        complete: real.length > 0 && real.every((t) => t.status === 'done'),
        items: items.map((t) => ({
          id: t.id, title: t.title, kind: t.kind, status: t.status, total: t.total, done: t.done,
          notes: t.notes, edits: t.edits, upstream: t.upstream, deferred: t.deferred, override: t.status_override,
        })),
      };
    });

    const real = tickets.filter((t) => t.kind === 'ticket' && !t.deferred);
    const totals = {
      steps: real.reduce((a, t) => a + t.total, 0),
      stepsDone: real.reduce((a, t) => a + t.done, 0),
      tickets: real.length,
      byStatus: real.reduce((m, t) => ((m[t.status] = (m[t.status] || 0) + 1), m), {}),
    };

    const resume = resumePointer(tickets);
    let current = null;
    if (resume) {
      const t = tickets.find((x) => x.id === resume.ticketId);
      current = { ...resume, title: t.title, status: t.status, total: t.total, done: t.done, sprintId: t.sprint_id };
    }
    const nextUp = real.filter((t) => t.status !== 'done' && t.id !== resume?.ticketId).slice(0, 3)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, total: t.total, done: t.done }));

    // activity
    const days = q(`SELECT date(ts,'localtime') AS d, count(*) AS n FROM activity WHERE type='done' GROUP BY d`).all();
    const map = new Map(days.map((r) => [r.d, r.n]));
    const last30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDay(d);
      last30.push({ day: key, n: map.get(key) || 0 });
    }
    let streak = 0;
    const cur = new Date();
    if (!map.get(localDay(cur))) cur.setDate(cur.getDate() - 1); // today not required yet
    while (map.get(localDay(cur))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
    const recent = q(
      `SELECT a.id, a.ts, a.type, a.ticket_id, a.step_id, t.title AS ticket_title, s.title AS step_title
       FROM activity a LEFT JOIN tickets t ON t.id=a.ticket_id LEFT JOIN steps s ON s.id=a.step_id
       WHERE a.type IN ('edit','note','reset') ORDER BY a.id DESC LIMIT 8`,
    ).all();
    const driftOpen = q(`SELECT count(*) n FROM drift WHERE state='open'`).get().n;

    const player = evaluate(db).player;
    return { sprints: bySprint, totals, player, current, nextUp, activity: last30, streak, recent, driftOpen, doneToday: map.get(localDay()) || 0 };
  }

  function planInfo(id) {
    let plan = null;
    try { plan = JSON.parse(getMeta(db, 'plan') || 'null'); } catch {}
    if (!plan) return null;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const sch = computeSchedule(plan, sprintsForPlan(), today, { daily: dailySteps() });
    const t = sch.sprints.flatMap((r) => r.schedule).find((x) => x.id === id);
    return { team: sch.team.map(({ id: mid, name, color, kind }) => ({ id: mid, name, color, kind })), ticket: t ? { member: t.member, due: t.due, start: t.start, manual: t.manual } : null };
  }

  function ticketDetail(id) {
    const t = q(`${TICKET_ROWS} WHERE t.id=?`).get(id);
    if (!t) throw notFound('Unknown ticket');
    const full = q('SELECT note FROM tickets WHERE id=?').get(id);
    const sprint = q('SELECT id, title FROM sprints WHERE id=?').get(t.sprint_id);
    const steps = q(
      `SELECT s.id, s.key, s.ord, s.kind, s.title, s.body, s.done, s.note, s.orphan, s.upstream_body, s.upstream_title,
              (s.body<>s.orig_body OR s.title<>s.orig_title) AS edited,
              (SELECT count(*) FROM drift d WHERE d.step_id=s.id AND d.state='open') AS drift
       FROM steps s WHERE s.ticket_id=? ORDER BY s.ord`,
    ).all(id);
    const order = allTickets().map((x) => x.id);
    const at = order.indexOf(id);
    return {
      ticket: { id: t.id, kind: t.kind, title: t.title, deferred: t.deferred, orphan: t.orphan, total: t.total, done: t.done,
        status: deriveStatus(t), override: t.status_override, note: full.note, sprint },
      steps: steps.map((s) => ({ ...s, edited: !!s.edited, hasUpstream: s.upstream_body !== null })),
      plan: planInfo(id),
      prev: at > 0 ? order[at - 1] : null,
      next: at >= 0 && at < order.length - 1 ? order[at + 1] : null,
    };
  }

  const getStep = (id) => {
    const s = q('SELECT * FROM steps WHERE id=?').get(id);
    if (!s) throw notFound('Unknown step');
    return s;
  };
  const str = (v, name, max = 2_000_000) => {
    if (typeof v !== 'string') throw bad(`"${name}" must be a string`);
    if (v.length > max) throw bad(`"${name}" is too long`);
    return v.replace(/\r\n?/g, '\n');
  };

  function saveStep(stepId, title, body, label) {
    const s = getStep(stepId);
    title = title.trim() || s.title;
    if (title === s.title && body === s.body) return s;
    tx(db, () => {
      q('UPDATE steps SET title=?, body=? WHERE id=?').run(title, body, stepId);
      q('INSERT INTO step_versions (step_id, title, body, label) VALUES (?,?,?,?)').run(stepId, title, body, label);
      q(`DELETE FROM step_versions WHERE step_id=? AND id NOT IN (SELECT id FROM step_versions WHERE step_id=? ORDER BY id DESC LIMIT 100)`).run(stepId, stepId);
      reindexStep(db, stepId);
      syncDrift(db, stepId);
      log(db, label === 'reset' ? 'reset' : 'edit', s.ticket_id, stepId, label);
    });
    return getStep(stepId);
  }

  const searchQuery = (raw) => {
    const toks = raw.match(/[\p{L}\p{N}_]+/gu) || [];
    return toks.slice(0, 8).map((t) => `"${t}"*`).join(' ');
  };

  // ------------------------------------------------------------------ routes
  // each route: [method, regex, handler(ctx)] ; ctx = {params, query, body}
  const routes = [];
  const on = (method, pattern, fn) => routes.push([method, new RegExp(`^${pattern}$`), fn]);

  on('GET', '/api/health', () => ({ ok: true }));
  on('GET', '/api/config', () => ({ hosted: false, version: cfg.version }));
  on('GET', '/api/overview', () => overview());

  // ---- saved board filters (per account): [{id, name, f:{sprint, who, q, view, group, hideDone}}]
  const cleanViews = (v) => (Array.isArray(v) ? v : []).map((x) => ({
    id: String(x?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || Math.random().toString(36).slice(2, 10),
    name: String(x?.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40),
    f: Object.fromEntries(['sprint', 'who', 'q', 'view', 'group'].map((k) => [k, String(x?.f?.[k] ?? '').slice(0, 80)]).concat([['hideDone', x?.f?.hideDone ? 1 : 0]])),
  })).filter((x) => x.name).slice(0, 30);
  on('GET', '/api/views', () => { let v = []; try { v = JSON.parse(getMeta(db, 'ui:views') || '[]'); } catch {} return cleanViews(v); });
  on('PUT', '/api/views', ({ body }) => { const v = cleanViews(body?.views); setMeta(db, 'ui:views', JSON.stringify(v)); return v; });

  // ---- per-ticket extras (priority, labels, subtasks, files, blocked reason)
  const hosted = !!cfg.hosted;
  on('GET', '/api/extras', () => extrasSummary(db));
  on('GET', '/api/tickets/([^/]+)/extras', ({ p }) => {
    const id = decodeURIComponent(p[0]);
    if (!q('SELECT 1 FROM tickets WHERE id=?').get(id)) throw notFound('Unknown ticket');
    return readExtras(db, id);
  });
  on('PUT', '/api/tickets/([^/]+)/extras', ({ p, body }) => {
    const id = decodeURIComponent(p[0]);
    if (!q('SELECT 1 FROM tickets WHERE id=?').get(id)) throw notFound('Unknown ticket');
    const cur = readExtras(db, id);
    // Locally files change only through the upload/delete routes; hosted clients manage their own storage objects.
    const next = normalize({ ...body, c: body.c === undefined ? cur.c : body.c, d: body.d === undefined ? cur.d : body.d }, { files: hosted ? body.f : cur.f });
    writeExtras(db, id, next);
    return next;
  });
  on('POST', '/api/tickets/([^/]+)/files', ({ p, body }) => {
    if (hosted) throw bad('Upload straight to storage in the hosted version.');
    const id = decodeURIComponent(p[0]);
    if (!q('SELECT 1 FROM tickets WHERE id=?').get(id)) throw notFound('Unknown ticket');
    const cur = readExtras(db, id);
    if (cur.f.length >= 30) throw bad('A ticket can hold up to 30 files.');
    let f;
    try { f = saveLocalFile(cfg, body); } catch (e) { throw bad(e.message); }
    cur.f.push(f);
    writeExtras(db, id, cur);
    log(db, 'file', id, null, f.n);
    return { file: f, extras: cur };
  });
  on('DELETE', '/api/tickets/([^/]+)/files/([a-f0-9]+)', ({ p }) => {
    const id = decodeURIComponent(p[0]);
    const cur = readExtras(db, id);
    const f = cur.f.find((x) => x.i === p[1]);
    if (!f) throw notFound('Unknown file');
    cur.f = cur.f.filter((x) => x !== f);
    writeExtras(db, id, cur);
    const fp = localPath(cfg, f.i);
    if (fp) fs.rmSync(fp, { force: true });
    return { extras: cur };
  });
  on('GET', '/api/files/([a-f0-9]+)', ({ p }) => {
    if (hosted) throw notFound();
    const fp = localPath(cfg, p[0]);
    if (!fp || !fs.existsSync(fp)) throw notFound('Unknown file');
    let meta = null;
    for (const r of db.prepare(`SELECT value FROM meta WHERE key LIKE 'tk:%'`).all()) { try { meta = JSON.parse(r.value).f?.find((x) => x.i === p[0]) || meta; } catch {} }
    if (!meta) throw notFound('Unknown file');
    return { __raw: true, body: fs.readFileSync(fp), type: isInline(meta.m) ? meta.m : 'application/octet-stream', filename: meta.n, inline: isInline(meta.m) };
  });

  on('GET', '/api/tickets/([^/]+)', ({ p }) => ticketDetail(decodeURIComponent(p[0])));
  on('PUT', '/api/tickets/([^/]+)/note', ({ p, body }) => {
    const id = decodeURIComponent(p[0]);
    const note = str(body.note, 'note', 200_000);
    if (!q('SELECT 1 FROM tickets WHERE id=?').get(id)) throw notFound();
    q('UPDATE tickets SET note=? WHERE id=?').run(note, id);
    return { ok: true };
  });
  on('PUT', '/api/tickets/([^/]+)/status', ({ p, body }) => {
    const id = decodeURIComponent(p[0]);
    const st = body.status ?? null;
    if (st !== null && !STATUSES.includes(st)) throw bad('Invalid status');
    if (!q('SELECT 1 FROM tickets WHERE id=?').get(id)) throw notFound();
    const { changed, undo } = applyTicketStatus(db, id, st);
    return withAward(db, { ok: true, steps: changed.length, undo, ticket: ticketSummary(id) });
  });

  on('POST', '/api/steps/(\\d+)/done', ({ p, body }) => {
    const s = getStep(Number(p[0]));
    if (!['step', 'verify'].includes(s.kind)) throw bad('This slide cannot be checked');
    const done = body.done ? 1 : 0;
    if (done !== s.done) {
      tx(db, () => {
        q(`UPDATE steps SET done=?, done_at=CASE WHEN ?=1 THEN datetime('now') END WHERE id=?`).run(done, done, s.id);
        log(db, done ? 'done' : 'undone', s.ticket_id, s.id);
        // A label (Ongoing / Test & fixes / Blocked) gives way once the last step is ticked: the ticket is Done.
        // Ticking a step on a "Pending" ticket means work has started, so that label is dropped too.
        if (done) {
          const t = q(`${TICKET_ROWS} WHERE t.id=?`).get(s.ticket_id);
          if (t?.status_override && (t.status_override === 'todo' || (t.total > 0 && t.done >= t.total))) q('UPDATE tickets SET status_override=NULL WHERE id=?').run(s.ticket_id);
        }
      });
    }
    return withAward(db, { ok: true, done, ticket: ticketSummary(s.ticket_id) });
  });
  on('PUT', '/api/steps/(\\d+)', ({ p, body }) => {
    const s = saveStep(Number(p[0]), str(body.title ?? '', 'title', 500), str(body.body, 'body'), 'edit');
    return withAward(db, { ok: true, edited: s.body !== s.orig_body || s.title !== s.orig_title });
  });
  on('PUT', '/api/steps/(\\d+)/note', ({ p, body }) => {
    const s = getStep(Number(p[0]));
    const note = str(body.note, 'note', 200_000);
    if (note !== s.note) {
      q('UPDATE steps SET note=? WHERE id=?').run(note, s.id);
      reindexStep(db, s.id);
      if (!s.note && note) log(db, 'note', s.ticket_id, s.id);
    }
    return withAward(db, { ok: true });
  });
  on('POST', '/api/steps/(\\d+)/reset', ({ p }) => {
    const s = getStep(Number(p[0]));
    saveStep(s.id, s.orig_title, s.orig_body, 'reset');
    return { ok: true };
  });
  on('GET', '/api/steps/(\\d+)/versions', ({ p }) => {
    const s = getStep(Number(p[0]));
    const versions = q('SELECT id, ts, title, body, label FROM step_versions WHERE step_id=? ORDER BY id DESC').all(s.id);
    return { original: { title: s.orig_title, body: s.orig_body }, current: { title: s.title, body: s.body }, versions };
  });
  on('POST', '/api/steps/(\\d+)/upstream', ({ p, body }) => {
    const s = getStep(Number(p[0]));
    if (s.upstream_body === null) throw bad('No upstream change pending');
    if (body.action === 'accept') {
      tx(db, () => {
        const title = s.upstream_title ?? s.title;
        q(`UPDATE steps SET title=?, body=?, orig_title=?, orig_body=?, upstream_body=NULL, upstream_title=NULL WHERE id=?`).run(title, s.upstream_body, title, s.upstream_body, s.id);
        q('INSERT INTO step_versions (step_id, title, body, label) VALUES (?,?,?,?)').run(s.id, title, s.upstream_body, 'accepted upstream');
        reindexStep(db, s.id);
        syncDrift(db, s.id);
        log(db, 'edit', s.ticket_id, s.id, 'accepted upstream');
      });
    } else if (body.action === 'keep') {
      q(`UPDATE steps SET orig_title=COALESCE(upstream_title, orig_title), orig_body=upstream_body, upstream_body=NULL, upstream_title=NULL WHERE id=?`).run(s.id);
    } else throw bad('action must be "accept" or "keep"');
    return { ok: true };
  });

  on('POST', '/api/bulk', ({ body }) => {
    const targets = { all: body.all === true, sprintIds: body.sprintIds, ticketIds: body.ticketIds };
    if (!targets.all && !targets.sprintIds?.length && !targets.ticketIds?.length) throw bad('Nothing selected');
    try {
      const r = bulk(db, body.action, targets, { dryRun: body.dryRun === true });
      return body.dryRun === true ? r : withAward(db, r);
    } catch (e) {
      throw bad(e.message);
    }
  });
  on('POST', '/api/bulk/undo', ({ body }) => {
    try {
      return { ...undoBulk(db, body), unlocked: [] };
    } catch (e) {
      throw bad(e.message);
    }
  });
  on('GET', '/api/achievements', () => evaluate(db));

  // ---- timeline plan (stored as JSON in meta)
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const todayOf = (query) => {
    const t = query?.get?.('today');
    return validDate(t) ? t : localToday();
  };
  const loadPlan = () => {
    try { return JSON.parse(getMeta(db, 'plan') || 'null'); } catch { return null; }
  };
  /** The minimum computeSchedule needs, without the heavier parts of overview(). */
  const sprintsForPlan = () => {
    const tickets = allTickets();
    // Real completion days from the activity log (ticks only; bulk "mark done" has no date and is shown as assumed).
    const lastDone = new Map(q(`SELECT ticket_id id, max(date(ts,'localtime')) d, min(date(ts,'localtime')) f FROM activity WHERE type='done' AND ticket_id IS NOT NULL GROUP BY ticket_id`).all().map((r) => [r.id, r]));
    return q('SELECT id, ord, title FROM sprints ORDER BY ord').all().map((sp) => {
      const items = tickets.filter((t) => t.sprint_id === sp.id);
      const real = items.filter((t) => t.kind === 'ticket' && !t.deferred);
      const dates = real.filter((t) => t.status === 'done').map((t) => lastDone.get(t.id)?.d).filter(Boolean).sort();
      const firsts = real.map((t) => lastDone.get(t.id)?.f).filter(Boolean).sort();
      return {
        doneOn: dates.length === real.filter((t) => t.status === 'done').length && dates.length ? dates.at(-1) : null,
        firstOn: firsts[0] || null,
        id: sp.id, title: sp.title,
        total: real.reduce((a, t) => a + t.total, 0), done: real.reduce((a, t) => a + t.done, 0),
        ticketsTotal: real.length, ticketsDone: real.filter((t) => t.status === 'done').length,
        complete: real.length > 0 && real.every((t) => t.status === 'done'),
        items: items.map((t) => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, total: t.total, done: t.done, deferred: t.deferred, doneOn: t.status === 'done' ? lastDone.get(t.id)?.d || null : null })),
      };
    });
  };
  const dailySteps = () => Object.fromEntries(q(`SELECT date(ts,'localtime') d, sum(type='done') - sum(type='undone') n FROM activity WHERE type IN ('done','undone') GROUP BY d`).all().map((r) => [r.d, Math.max(0, r.n)]));
  const stepsDone = () => sprintsForPlan().reduce((a, x) => a + x.done, 0);
  const sched = (plan, today) => computeSchedule(plan, sprintsForPlan(), today, { daily: dailySteps() });
  const planOut = (plan, today) => ({ plan: plan && cleanPlan(plan), schedule: plan ? sched(plan, today) : null, today, progress: { stepsDone: stepsDone(), sprintsDone: sprintsForPlan().filter((x) => x.complete).length } });
  /** Keeps manual overrides, and fixes the "steps done before the anchor" baseline (new anchor, or an explicit re-plan). */
  const keepManual = (body) => {
    const prev = loadPlan();
    const out = body.manual === undefined ? { ...body, manual: prev?.manual } : { ...body };
    if (out.anchor === 'here') {
      if (body.rebase || prev?.anchor !== 'here' || !Number.isInteger(prev?.baseSteps)) out.baseSteps = stepsDone();
      else out.baseSteps = prev.baseSteps;
    }
    delete out.rebase;
    return out;
  };
  const planOrBad = (body) => { try { return cleanPlan(body); } catch (e) { throw bad(e.message); } };
  on('GET', '/api/plan', ({ query }) => planOut(loadPlan(), todayOf(query)));
  on('POST', '/api/plan/preview', ({ body, query }) => {
    const plan = planOrBad(keepManual(body));
    return { schedule: sched(plan, todayOf(query)) };
  });
  on('PUT', '/api/plan', ({ body, query }) => {
    const plan = planOrBad(keepManual(body));
    setMeta(db, 'plan', JSON.stringify(plan));
    return planOut(plan, todayOf(query));
  });
  // What-if: the saved plan with some fields changed, computed but never stored. Body: {changes: {workDays, sprintDays, targetEnd, daysOff, team, startDate}}.
  on('POST', '/api/plan/scenario', ({ body, query }) => {
    const base = loadPlan();
    if (!base) throw bad('Create a timeline first.');
    const allowed = ['workDays', 'sprintDays', 'targetEnd', 'daysOff', 'team', 'startDate', 'anchor'];
    const ch = Object.fromEntries(Object.entries(body?.changes || {}).filter(([k]) => allowed.includes(k)));
    const plan = planOrBad({ ...base, ...ch, manual: base.manual });
    const today = todayOf(query);
    const pick = (sch) => ({ plannedEnd: sch.plannedEnd, projectedEnd: sch.projectedEnd, weeks: sch.weeks, workDaysTotal: sch.workDaysTotal, fit: sch.fit, team: sch.team.length });
    return { current: pick(sched(base, today)), scenario: pick(sched(plan, today)) };
  });
  // Per-ticket overrides of the auto plan: {ticketId, member?, due?, start?} (null removes a field), or {ticketId, clear:true}.
  on('PUT', '/api/plan/manual', ({ body, query }) => {
    const plan = loadPlan();
    if (!plan) throw bad('Create a timeline first.');
    const id = str(body.ticketId, 'ticketId', 60);
    if (!q(`SELECT 1 FROM tickets WHERE id=? AND kind='ticket'`).get(id)) throw notFound('Unknown ticket');
    const manual = { ...(plan.manual || {}) };
    const cur = body.clear ? {} : { ...(manual[id] || {}) };
    for (const k of ['member', 'due', 'start']) {
      if (body[k] === undefined) continue;
      if (body[k] === null) delete cur[k];
      else cur[k] = body[k];
    }
    if (Object.keys(cur).length) manual[id] = cur;
    else delete manual[id];
    const next = planOrBad({ ...plan, manual });
    setMeta(db, 'plan', JSON.stringify(next));
    return planOut(next, todayOf(query));
  });
  on('DELETE', '/api/plan/manual', () => {
    const plan = loadPlan();
    if (plan) setMeta(db, 'plan', JSON.stringify({ ...plan, manual: {} }));
    return { ok: true };
  });
  on('DELETE', '/api/plan', () => {
    db.prepare(`DELETE FROM meta WHERE key='plan'`).run();
    return { ok: true };
  });

  on('POST', '/api/resume', ({ body }) => {
    if (typeof body.ticketId !== 'string') throw bad('ticketId required');
    setMeta(db, 'resume', JSON.stringify({ ticketId: body.ticketId, stepId: Number.isInteger(body.stepId) ? body.stepId : null }));
    return { ok: true };
  });

  on('GET', '/api/search', ({ query }) => {
    const m = searchQuery(String(query.get('q') || ''));
    if (!m) return { results: [] };
    const limit = Math.min(Number(query.get('limit')) || 30, 100);
    const rows = q(
      `SELECT s.id, s.ticket_id, s.title AS step_title, s.kind, t.title AS ticket_title, t.kind AS ticket_kind,
              snippet(steps_fts, 1, char(1), char(2), '…', 18) AS body_snip,
              snippet(steps_fts, 2, char(1), char(2), '…', 12) AS note_snip,
              snippet(steps_fts, 0, char(1), char(2), '…', 12) AS title_snip
       FROM steps_fts f JOIN steps s ON s.id = f.rowid JOIN tickets t ON t.id = s.ticket_id
       WHERE steps_fts MATCH ? AND s.orphan=0 ORDER BY bm25(steps_fts, 8, 1, 2, 5) LIMIT ?`,
    ).all(m, limit);
    return { results: rows };
  });

  on('GET', '/api/drift', ({ query }) => {
    const state = query.get('state') || 'open';
    const rows = q(
      `SELECT d.id, d.state, d.note, d.line, d.step_id, s.title AS step_title, s.ticket_id, t.title AS ticket_title
       FROM drift d JOIN steps s ON s.id=d.step_id JOIN tickets t ON t.id=s.ticket_id JOIN sprints sp ON sp.id=t.sprint_id
       WHERE s.orphan=0 ${state === 'all' ? '' : 'AND d.state=?'} ORDER BY sp.ord, t.ord, s.ord, d.pos`,
    ).all(...(state === 'all' ? [] : [state]));
    const counts = Object.fromEntries(q('SELECT state, count(*) n FROM drift GROUP BY state').all().map((r) => [r.state, r.n]));
    return { items: rows, counts };
  });
  on('PUT', '/api/drift/(\\d+)', ({ p, body }) => {
    const id = Number(p[0]);
    if (!q('SELECT 1 FROM drift WHERE id=?').get(id)) throw notFound();
    if (body.state !== undefined) {
      if (!['open', 'checked', 'fixed', 'wrong'].includes(body.state)) throw bad('Invalid state');
      q('UPDATE drift SET state=? WHERE id=?').run(body.state, id);
    }
    if (body.note !== undefined) q('UPDATE drift SET note=? WHERE id=?').run(str(body.note, 'note', 5000), id);
    return withAward(db, { ok: true });
  });

  on('GET', '/api/info', () => ({
    version: cfg.version,
    node: process.version,
    dbPath: cfg.dbPath,
    contentDir: cfg.contentDir,
    exportDir: cfg.exportDir,
    lastImport: getMeta(db, 'last_import'),
    backups: fs.existsSync(path.join(cfg.dataDir, 'backups')) ? fs.readdirSync(path.join(cfg.dataDir, 'backups')).sort().reverse() : [],
    sprints: q('SELECT id, title, file FROM sprints ORDER BY ord').all(),
  }));

  on('POST', '/api/import', ({ body }) => {
    let files = body.files;
    if (files !== undefined) {
      if (!Array.isArray(files) || !files.length) throw bad('files must be a non-empty array');
      files = files.map((f) => ({ name: str(f.name, 'name', 200), text: str(f.text, 'text', 20_000_000) }));
    } else files = readContentDir(cfg.contentDir);
    if (!files.length) throw bad(`No sprint-*.md files found in ${cfg.contentDir}`);
    backupDb(db, cfg.dataDir);
    try {
      return { report: importFiles(db, files) };
    } catch (e) {
      throw bad(e.message);
    }
  });

  on('GET', '/api/export/([^/]+)', ({ p }) => {
    const out = exportSprintMarkdown(db, decodeURIComponent(p[0]));
    if (!out) throw notFound('Unknown sprint');
    return { __raw: true, type: 'text/markdown; charset=utf-8', filename: out.file, body: out.text };
  });
  on('POST', '/api/export', () => ({ dir: cfg.exportDir, files: exportAllToDir(db, cfg.exportDir) }));

  return function handle(method, pathname, query, body) {
    for (const [m, re, fn] of routes) {
      if (m !== method) continue;
      const mm = re.exec(pathname);
      if (mm) return fn({ p: mm.slice(1), query, body: body ?? {} });
    }
    throw notFound('Unknown endpoint');
  };
}
