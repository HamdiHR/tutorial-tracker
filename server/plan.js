// Timeline planner: turns a small "plan" (start date, working days, sprint length...) into a dated
// schedule per sprint and per ticket, and compares it with real progress. Pure functions, no I/O.
// Dates are plain 'YYYY-MM-DD' strings handled as UTC days, so time zones never shift a date.

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 3660; // safety cap for every loop (about ten years)

const toMs = (s) => Date.parse(s + 'T00:00:00Z');
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
export const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && fmt(toMs(s)) === s;
export const addDays = (s, n) => fmt(toMs(s) + n * DAY);
export const dayOfWeek = (s) => new Date(toMs(s)).getUTCDay(); // 0 = Sunday

export const DEFAULT_PLAN = { anchor: 'start', baseSteps: 0, targetEnd: null, startDate: null, workDays: [1, 2, 3, 4, 5], sprintDays: 5, perSprint: {}, daysOff: [], team: [], manual: {} };

const PALETTE = ['#7aa2ff', '#3fb27f', '#e3a93b', '#c084fc', '#f472b6', '#22d3ee', '#fb923c', '#a3e635', '#f87171', '#94a3b8', '#2dd4bf', '#facc15'];
const cleanDayList = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
const cleanDates = (v, what) => {
  const out = [...new Set(Array.isArray(v) ? v : [])];
  if (out.length > 400 || !out.every(validDate)) throw new Error(`${what} must be valid dates.`);
  return out.sort();
};

function cleanTeam(input) {
  const arr = Array.isArray(input) && input.length ? input : [{}];
  if (arr.length > 12) throw new Error('A team can have up to 12 people.');
  const seen = new Set();
  return arr.map((m, i) => {
    const name = String(m?.name ?? '').trim().slice(0, 30) || (arr.length === 1 ? 'You' : `Member ${i + 1}`);
    let id = typeof m?.id === 'string' && /^[a-z0-9_-]{1,16}$/i.test(m.id) && !seen.has(m.id) ? m.id : `m${i + 1}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    const color = typeof m?.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : PALETTE[i % PALETTE.length];
    const wd = cleanDayList(m?.workDays);
    return { id, name, color, workDays: wd.length ? wd : null, daysOff: cleanDates(m?.daysOff, `${name}: days off`) };
  });
}

function cleanManual(input, team) {
  const ids = new Set(team.map((m) => m.id));
  const out = {};
  for (const [tid, v] of Object.entries(input && typeof input === 'object' ? input : {}).slice(0, 2000)) {
    if (!v || typeof v !== 'object' || tid.length > 60) continue;
    const m = {};
    if (typeof v.member === 'string' && ids.has(v.member)) m.member = v.member;
    if (validDate(v.due)) m.due = v.due;
    if (validDate(v.start) && m.due && v.start <= m.due) m.start = v.start;
    if (Object.keys(m).length) out[tid] = m;
  }
  return out;
}

/** Validates and normalises user input; throws Error with a readable message. */
export function cleanPlan(input) {
  const p = input && typeof input === 'object' ? input : {};
  if (!validDate(p.startDate)) throw new Error('Pick a valid start date.');
  const workDays = cleanDayList(p.workDays);
  if (!workDays.length) throw new Error('Choose at least one working day per week.');
  const sprintDays = Number(p.sprintDays);
  if (!Number.isInteger(sprintDays) || sprintDays < 1 || sprintDays > 60) throw new Error('Sprint length must be between 1 and 60 working days.');
  const perSprint = {};
  for (const [id, v] of Object.entries(p.perSprint && typeof p.perSprint === 'object' ? p.perSprint : {})) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error(`Sprint ${id}: length must be between 1 and 60 working days.`);
    if (n !== sprintDays) perSprint[String(id).slice(0, 12)] = n;
  }
  const team = cleanTeam(p.team);
  // anchor 'start': every sprint is laid out from the start date (original behaviour).
  // anchor 'here': finished work is history; the start date is where the *unfinished* work begins.
  const anchor = p.anchor === 'here' ? 'here' : 'start';
  const baseSteps = Number.isInteger(p.baseSteps) && p.baseSteps >= 0 ? p.baseSteps : 0;
  const targetEnd = p.targetEnd == null || p.targetEnd === '' ? null : p.targetEnd;
  if (targetEnd !== null && (!validDate(targetEnd) || targetEnd < p.startDate)) throw new Error('The target end date must be a valid date on or after the start date.');
  return { anchor, baseSteps, targetEnd, startDate: p.startDate, workDays, sprintDays, perSprint, daysOff: cleanDates(p.daysOff, 'Days off'), team, manual: cleanManual(p.manual, team) };
}

/** Checker for one person: their own weekdays (or the plan's) minus shared and personal days off. */
function checker(plan, member) {
  const off = new Set([...plan.daysOff, ...(member?.daysOff || [])]);
  const wd = new Set(member?.workDays || plan.workDays);
  return (d) => wd.has(dayOfWeek(d)) && !off.has(d);
}

/** First `count` working days starting on/after `from`. */
function takeWorkdays(isWork, from, count) {
  const out = [];
  let d = from;
  for (let i = 0; i < MAX_DAYS * 2 && out.length < count; i++, d = addDays(d, 1)) if (isWork(d)) out.push(d);
  return out;
}

/**
 * sprints: [{id, title, ticketsTotal, ticketsDone, total (steps), done, complete, items:[{id,title,kind,status,deferred,total,done}]}]
 * today: 'YYYY-MM-DD'. Returns the dated schedule (per sprint, per ticket, per person) and a comparison with progress.
 * A sprint window runs on the team calendar (a day counts if anyone works). Tickets are split between people by
 * workload (steps per available day), keep tutorial order per person, and are spread over that person's own days.
 */
export function computeSchedule(planIn, sprints, today, extra = {}) {
  const plan = cleanPlan(planIn);
  if (!validDate(today)) throw new Error('Invalid today');
  const members = plan.team.map((m) => ({ ...m, works: checker(plan, m) }));
  const isTeamWork = (d) => members.some((m) => m.works(d));
  const tdy = today;
  const tally = members.map(() => ({ tickets: 0, steps: 0, stepsDone: 0, days: 0 }));

  const here = plan.anchor === 'here';
  const histDay = addDays(plan.startDate, -1); // where finished work with no known date is drawn
  const live = sprints.filter((x) => x.ticketsTotal && !(here && x.complete));
  // Target end date: spread the available working days over the unfinished sprints by remaining steps.
  let targetDays = null;
  let targetAvail = 0;
  if (here && plan.targetEnd && live.length) {
    targetAvail = takeWorkdays(isTeamWork, plan.startDate, MAX_DAYS).filter((d) => d <= plan.targetEnd).length;
    const wt = live.map((x) => Math.max(1, x.total - x.done));
    const sum = wt.reduce((a, b) => a + b, 0);
    targetDays = new Map(live.map((x, i) => [x.id, Math.max(1, Math.round((Math.max(1, targetAvail) * wt[i]) / sum))]));
  }
  let cursor = plan.startDate;
  const rows = [];
  let activeSeen = false;
  for (const sp of sprints) {
    if (!sp.ticketsTotal) continue;
    if (here && sp.complete) {
      // History: finished before the anchor. Uses real completion dates when the activity log has them.
      const real = sp.items.filter((t) => t.kind === 'ticket' && !t.deferred);
      const hist = real.map((t) => {
        const d = t.doneOn || sp.doneOn || histDay;
        return { id: t.id, title: t.title, status: t.status, member: members.find((m) => m.id === plan.manual[t.id]?.member)?.id || members[0].id, due: d, start: d, steps: t.total || 0, done: t.done || 0, manual: { member: false, due: false }, history: true, assumed: !(t.doneOn || sp.doneOn) };
      });
      const ds = hist.map((t) => t.due).sort();
      rows.push({ id: sp.id, title: sp.title, start: sp.firstOn && sp.firstOn <= ds[0] ? sp.firstOn : ds[0], end: ds.at(-1), days: 0, tickets: real.length, ticketsDone: sp.ticketsDone, steps: sp.total, stepsDone: sp.done, expectedPct: 100, actualPct: 100, state: 'done', history: true, assumed: hist.every((t) => t.assumed), schedule: hist, load: members.map((m) => ({ member: m.id, tickets: 0, steps: 0, done: 0, days: 0 })) });
      continue;
    }
    let days = plan.perSprint[sp.id] ?? targetDays?.get(sp.id) ?? plan.sprintDays;
    // First unfinished sprint that is already under way: only its remaining work needs days.
    const isActive = here && !activeSeen;
    activeSeen = true;
    const partial = isActive && sp.done > 0 && sp.total > 0;
    if (partial && plan.perSprint[sp.id] == null && !targetDays) days = Math.max(1, Math.min(days, Math.ceil((days * (sp.total - sp.done)) / sp.total)));
    const wd = takeWorkdays(isTeamWork, cursor, days);
    const start = wd[0];
    const end = wd[wd.length - 1];
    cursor = addDays(end, 1);

    const allReal = sp.items.filter((t) => t.kind === 'ticket' && !t.deferred);
    const finished = partial ? allReal.filter((t) => t.status === 'done') : [];
    const tickets = partial ? allReal.filter((t) => t.status !== 'done') : allReal;
    const w = (t) => Math.max(1, t.total || 0);
    const avail = members.map((m) => wd.filter(m.works));
    const load = members.map(() => 0);
    const count = members.map(() => 0);
    const owner = new Map();
    const take = (t, i) => { owner.set(t.id, i); load[i] += w(t); count[i]++; };
    for (const t of tickets) {
      const i = members.findIndex((m) => m.id === plan.manual[t.id]?.member);
      if (i >= 0) take(t, i);
    }
    const rot = rows.length % members.length;
    for (const t of tickets) {
      if (owner.has(t.id)) continue;
      const pool = members.map((_, i) => i).filter((i) => avail[i].length);
      const cand = pool.length ? pool : members.map((_, i) => i);
      let best = cand[0];
      let bestKey = null;
      for (const i of cand) {
        const key = [(load[i] + w(t)) / Math.max(1, avail[i].length), (i - rot + members.length) % members.length];
        if (!bestKey || key[0] < bestKey[0] - 1e-9 || (Math.abs(key[0] - bestKey[0]) < 1e-9 && key[1] < bestKey[1])) { best = i; bestKey = key; }
      }
      take(t, best);
    }

    const dated = new Map();
    members.forEach((m, i) => {
      const mine = tickets.filter((t) => owner.get(t.id) === i);
      const total = mine.reduce((a, t) => a + w(t), 0);
      const dd = avail[i].length ? avail[i] : wd;
      let cum = 0;
      let prev = -1;
      for (const t of mine) {
        cum += w(t);
        const idx = Math.max(0, Math.min(dd.length - 1, Math.ceil((cum / total) * dd.length) - 1));
        const sIdx = prev < 0 ? 0 : prev === idx ? idx : prev + 1;
        prev = idx;
        const man = plan.manual[t.id] || {};
        let due = man.due || dd[idx];
        let st = man.start || dd[Math.min(sIdx, idx)];
        if (st > due) st = due;
        dated.set(t.id, { id: t.id, title: t.title, status: t.status, member: m.id, due, start: st, steps: t.total || 0, done: t.done || 0, manual: { member: !!man.member, due: !!man.due } });
      }
    });
    const histOf = new Map(finished.map((t) => {
      const d = t.doneOn || histDay;
      return [t.id, { id: t.id, title: t.title, status: t.status, member: members.find((m) => m.id === plan.manual[t.id]?.member)?.id || members[0].id, due: d, start: d, steps: t.total || 0, done: t.done || 0, manual: { member: false, due: false }, history: true, assumed: !t.doneOn }];
    }));
    const schedule = allReal.map((t) => dated.get(t.id) || histOf.get(t.id)).filter(Boolean);
    const baseFrac = partial ? finished.reduce((a, t) => a + (t.total || 0), 0) / sp.total : 0;

    members.forEach((_, i) => {
      const mine = schedule.filter((t) => t.member === members[i].id && !t.history);
      tally[i].tickets += mine.length;
      tally[i].steps += mine.reduce((a, t) => a + t.steps, 0);
      tally[i].stepsDone += mine.reduce((a, t) => a + t.done, 0);
      tally[i].days += avail[i].length;
    });

    const n = allReal.length;
    const elapsed = wd.filter((d) => d <= tdy).length;
    const expected = baseFrac + (1 - baseFrac) * Math.min(1, elapsed / days);
    const actual = sp.total ? sp.done / sp.total : 0;
    let state;
    if (sp.complete) state = 'done';
    else if (tdy < start) state = 'upcoming';
    else if (tdy > end) state = 'overdue';
    else if (actual - expected >= 0.1) state = 'ahead';
    else if (actual - expected >= -0.1) state = 'on-track';
    else state = 'behind';
    const loadOut = members.map((m, i) => {
      const mine = schedule.filter((t) => t.member === m.id && !t.history);
      return { member: m.id, tickets: mine.length, steps: mine.reduce((a, t) => a + t.steps, 0), done: mine.reduce((a, t) => a + t.done, 0), days: avail[i].length };
    });
    rows.push({ id: sp.id, title: sp.title, start, end, days, tickets: n, ticketsDone: sp.ticketsDone, steps: sp.total, stepsDone: sp.done, expectedPct: Math.round(expected * 100), actualPct: Math.round(actual * 100), state, schedule, load: loadOut, partial });
  }

  const totalSteps = rows.reduce((a, r) => a + r.steps, 0);
  const doneSteps = rows.reduce((a, r) => a + r.stepsDone, 0);
  const expectedSteps = Math.round(rows.reduce((a, r) => a + (r.expectedPct / 100) * r.steps, 0));
  const plannedEnd = rows.length ? rows.at(-1).end : null;

  const elapsedAll = takeWorkdays(isTeamWork, plan.startDate, MAX_DAYS).filter((d) => d <= tdy).length;
  const doneSince = Math.max(0, doneSteps - (here ? plan.baseSteps : 0));
  const remaining = Math.max(0, totalSteps - doneSteps);
  const startFrom = takeWorkdays(isTeamWork, tdy < plan.startDate ? plan.startDate : addDays(tdy, 1), 1)[0];
  const finishAt = (pace) => (pace > 0 ? takeWorkdays(isTeamWork, startFrom, Math.min(Math.ceil(remaining / pace), MAX_DAYS)).at(-1) ?? null : null);
  // Recent velocity: steps ticked per working day over the last 7 / 14 working days (needs the activity log).
  const daily = extra.daily || {};
  const recent = (n) => {
    const days = takeWorkdays(isTeamWork, addDays(tdy, -40), 60).filter((d) => d <= tdy).slice(-n);
    const sum = days.reduce((a, d) => a + (daily[d] || 0), 0);
    return days.length >= Math.min(n, 3) && sum > 0 ? sum / days.length : null;
  };
  let projectedEnd = null;
  let pace = null;
  let forecast = null;
  if (doneSteps >= totalSteps && totalSteps) projectedEnd = 'done';
  else if (elapsedAll >= 3 && doneSince > 0) {
    pace = doneSince / elapsedAll;
    projectedEnd = finishAt(pace);
    const paces = [pace, recent(7), recent(14)].filter((x) => x > 0);
    forecast = { fast: finishAt(Math.max(...paces)), expected: projectedEnd, slow: finishAt(Math.min(...paces)), pace7: recent(7), pace14: recent(14) };
  }
  const fit = here && plan.targetEnd ? { targetEnd: plan.targetEnd, days: targetAvail, neededPace: targetAvail ? Math.round((remaining / targetAvail) * 10) / 10 : null, ok: !!rows.length && rows.at(-1).end <= plan.targetEnd } : null;

  const all = rows.flatMap((r) => r.schedule);
  const dueNow = all.filter((t) => t.due <= tdy && t.status !== 'done');
  const workDaysTotal = rows.reduce((a, r) => a + r.days, 0);
  return {
    plan,
    team: members.map((m, i) => ({ id: m.id, name: m.name, color: m.color, workDays: m.workDays, daysOff: m.daysOff, ...tally[i] })),
    sprints: rows,
    plannedEnd,
    projectedEnd,
    forecast,
    fit,
    anchor: plan.anchor,
    historySprints: rows.filter((r) => r.history).length,
    pace,
    today: {
      date: tdy,
      isWorkday: isTeamWork(tdy),
      expectedSteps,
      actualSteps: doneSteps,
      deltaSteps: doneSteps - expectedSteps,
      totalSteps,
      dueTickets: dueNow.length,
      overdue: dueNow.filter((t) => t.due < tdy).length,
      next: all.filter((t) => t.status !== 'done').slice(0, 4),
    },
    workDaysTotal,
    weeks: Math.round((workDaysTotal / plan.workDays.length) * 10) / 10,
  };
}
