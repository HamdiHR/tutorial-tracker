import { h, toast, debounce } from './dom.js';
import { api } from './api.js';
import { S, ls, sprintLabel, sprintName, shortId, STATUS_LABEL } from './state.js';
import { openModal } from './modal.js';
import { enter } from './motion.js';
import { todayStr, parse, fmtDate, dayDiff, nextMonday, addDaysStr, plural } from './dates.js';
import { avatar } from './ui.js';
import { openDrawer } from './drawer.js';
import { roadmap, agenda, calendar } from './roadmap.js';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const STATE = { done: ['Done', 'done'], ahead: ['Ahead', 'done'], 'on-track': ['On track', 'accent'], behind: ['Behind', 'doing'], overdue: ['Overdue', 'blocked'], upcoming: ['Upcoming', 'muted'] };


/** The questions. `initial` is a saved plan or null. Calls onSave(plan) after saving. */
function planForm(initial, onSave, onCancel) {
  const sprints = S.overview.sprints.filter((sp) => sp.ticketsTotal);
  const done = sprints.filter((sp) => sp.ticketsDone === sp.ticketsTotal);
  const current = sprints.find((sp) => sp.ticketsDone < sp.ticketsTotal);
  const hasProgress = sprints.some((sp) => sp.ticketsDone > 0 || sp.done > 0);
  const st = {
    anchor: initial?.anchor || (hasProgress ? 'here' : 'start'),
    targetEnd: initial?.targetEnd || '',
    rebase: false,
    startDate: initial?.startDate || (hasProgress ? todayStr() : nextMonday()),
    workDays: new Set(initial?.workDays || [1, 2, 3, 4, 5]),
    sprintDays: initial?.sprintDays || 5,
    perSprint: { ...(initial?.perSprint || {}) },
    daysOff: [...(initial?.daysOff || [])],
    team: (initial?.team?.length ? initial.team : [{ name: 'You' }]).map((m) => ({ id: m.id, name: m.name, color: m.color, workDays: m.workDays ? new Set(m.workDays) : null, daysOff: [...(m.daysOff || [])] })),
  };
  let unit = initial && initial.sprintDays % (initial.workDays.length || 5) === 0 ? 'weeks' : 'days';
  const err = h('div', { class: 'banner bad', hidden: true });
  const preview = h('div', { class: 'tl-preview' }, 'Calculating…');

  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const plan = () => ({
    anchor: st.anchor, targetEnd: st.anchor === 'here' && st.targetEnd ? st.targetEnd : null, rebase: st.rebase,
    startDate: st.startDate, workDays: [...st.workDays], sprintDays: st.sprintDays, perSprint: st.perSprint, daysOff: st.daysOff,
    team: st.team.map((m, i) => ({ id: m.id, name: st.team.length === 1 ? m.name || 'You' : m.name || `Member ${i + 1}`, color: m.color, workDays: m.workDays && !same(m.workDays, st.workDays) ? [...m.workDays] : null, daysOff: m.daysOff })),
  });
  const refresh = debounce(async () => {
    try {
      const { schedule } = await api.planPreview(plan(), todayStr());
      err.hidden = true;
      const fit = schedule.fit;
      preview.replaceChildren(schedule.historySprints ? h('div', { class: 'muted small' }, `✓ ${plural(schedule.historySprints, 'finished sprint')} kept as history, not rescheduled`) : null, fit ? h('div', { class: fit.ok ? 'small' : 'small late' }, fit.ok ? `🎯 Fits your target of ${fmtDate(fit.targetEnd, true)} (needs ≈ ${fit.neededPace} steps per working day)` : `⚠ ${fmtDate(fit.targetEnd, true)} is too tight: you would need ≈ ${fit.neededPace} steps per working day`) : null, h('span', {}, '→ ', schedule.team.length > 1 ? `team of ${schedule.team.length} · ` : '', plural(schedule.sprints.length, 'sprint'), ' · ', plural(schedule.workDaysTotal, 'working day'), ` (≈ ${plural(schedule.weeks, 'week')}) · finishes `), h('strong', {}, fmtDate(schedule.plannedEnd, true)));
    } catch (e) { preview.replaceChildren(h('span', { class: 'muted' }, e.message)); }
  }, 250);

  const start = h('input', { type: 'date', value: st.startDate, onInput: (e) => { st.startDate = e.target.value; st.rebase = true; refresh(); } });
  const targetIn = h('input', { type: 'date', value: st.targetEnd, onInput: (e) => { st.targetEnd = e.target.value; refresh(); } });
  const anchorBox = h('div', { class: 'tl-field' });
  const startQ = h('strong', {});
  const startHint = h('span', { class: 'muted small' });
  const targetField = h('div', { class: 'tl-field' }, h('div', { class: 'tl-q' }, h('strong', {}, 'Want to finish by a certain date? (optional)'), h('span', { class: 'muted small' }, 'We spread the remaining sprints over the days available and tell you if it is unrealistic.')), h('div', { class: 'row wrap gap' }, targetIn, h('button', { type: 'button', class: 'btn sm', onClick: () => { targetIn.value = ''; st.targetEnd = ''; refresh(); } }, 'Clear')));
  const paintAnchor = () => {
    const here = st.anchor === 'here';
    startQ.textContent = here ? 'When do you pick up the unfinished work?' : 'When does your first sprint begin?';
    startHint.textContent = here ? 'The first working day on or after this date is when the unfinished work starts. Finished sprints stay in the past.' : 'The first working day on or after this date is day 1.';
    targetField.hidden = !here;
    if (!hasProgress) return anchorBox.replaceChildren();
    const opt = (v, title, desc) => h('label', { class: 'tl-opt' + (st.anchor === v ? ' on' : '') }, h('input', { type: 'radio', name: 'anchor', checked: st.anchor === v, onChange: () => { st.anchor = v; st.rebase = true; paintAnchor(); refresh(); } }), h('span', {}, h('strong', {}, title), h('span', { class: 'muted small' }, desc)));
    anchorBox.replaceChildren(
      h('div', { class: 'tl-q' }, h('strong', {}, 'You already have progress'), h('span', { class: 'muted small' }, `${plural(done.length, 'sprint')} finished${current ? `, ${sprintLabel(current)} in progress (${current.ticketsDone}/${current.ticketsTotal} tickets)` : ''}. How should the calendar treat it?`)),
      h('div', { class: 'tl-opts' },
        opt('here', 'Continue from where I am', 'Finished work stays as history. Only what is left is scheduled, starting on the date below.'),
        opt('start', 'Lay everything out from sprint 1', 'The old behaviour: every sprint gets a slot from the start date, finished or not.')));
  };
  paintAnchor();
  const lenNum = h('input', { type: 'number', min: 1, max: 60, class: 'num', value: unit === 'weeks' ? st.sprintDays / st.workDays.size : st.sprintDays });
  const lenUnit = h('select', {}, h('option', { value: 'days' }, 'working days'), h('option', { value: 'weeks' }, 'weeks'));
  lenUnit.value = unit;
  const lenSync = () => {
    const n = Number(lenNum.value) || 1;
    st.sprintDays = Math.max(1, Math.round(lenUnit.value === 'weeks' ? n * st.workDays.size : n));
    refresh();
  };
  lenNum.addEventListener('input', lenSync);
  lenUnit.addEventListener('change', lenSync);

  const dayBtns = DAYS.map(([n, label]) => {
    const b = h('button', { type: 'button', class: 'daychip' + (st.workDays.has(n) ? ' on' : ''), 'aria-pressed': st.workDays.has(n), onClick: () => {
      st.workDays.has(n) ? st.workDays.delete(n) : st.workDays.add(n);
      b.classList.toggle('on', st.workDays.has(n));
      b.setAttribute('aria-pressed', st.workDays.has(n));
      lenSync();
    } }, label);
    return b;
  });

  const offList = h('div', { class: 'row wrap gap' });
  const offInput = h('input', { type: 'date' });
  const paintOff = () => offList.replaceChildren(...st.daysOff.map((d) => h('span', { class: 'daychip on rm' }, fmtDate(d, true), h('button', { type: 'button', 'aria-label': 'Remove ' + d, onClick: () => { st.daysOff = st.daysOff.filter((x) => x !== d); paintOff(); refresh(); } }, '×'))));
  paintOff();
  const addOff = () => { if (offInput.value && !st.daysOff.includes(offInput.value)) { st.daysOff = [...st.daysOff, offInput.value].sort(); paintOff(); refresh(); } offInput.value = ''; };


  // ---- team
  const teamBox = h('div', { class: 'tl-team' });
  const teamNum = h('input', { type: 'number', min: 1, max: 12, class: 'num', value: st.team.length, onInput: (e) => {
    const n = Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 1)));
    while (st.team.length < n) st.team.push({ name: `Member ${st.team.length + 1}`, workDays: null, daysOff: [] });
    st.team.length = n;
    if (n > 1 && st.team[0].name === 'You') st.team[0].name = 'Member 1';
    paintTeam(); refresh();
  } });
  function paintTeam() {
    teamBox.replaceChildren(...(st.team.length < 2 ? [] : st.team.map((m, i) => {
      const color = m.color || ['#7aa2ff', '#3fb27f', '#e3a93b', '#c084fc', '#f472b6', '#22d3ee', '#fb923c', '#a3e635', '#f87171', '#94a3b8', '#2dd4bf', '#facc15'][i % 12];
      const mine = m.workDays || st.workDays;
      const chips = DAYS.map(([n, label]) => {
        const b = h('button', { type: 'button', class: 'daychip sm' + (mine.has(n) ? ' on' : ''), onClick: () => {
          if (!m.workDays) m.workDays = new Set(st.workDays);
          m.workDays.has(n) ? m.workDays.delete(n) : m.workDays.add(n);
          if (!m.workDays.size) m.workDays.add(n);
          paintTeam(); refresh();
        } }, label);
        return b;
      });
      const off = h('span', { class: 'row wrap gap' }, m.daysOff.map((d) => h('span', { class: 'daychip on rm sm' }, fmtDate(d, true), h('button', { type: 'button', 'aria-label': 'Remove ' + d, onClick: () => { m.daysOff = m.daysOff.filter((x) => x !== d); paintTeam(); refresh(); } }, '×'))));
      const offIn = h('input', { type: 'date' });
      return h('div', { class: 'tl-member' },
        h('div', { class: 'row gap' }, avatar({ name: m.name || String(i + 1), color }), h('input', { class: 'tl-name', type: 'text', maxlength: 30, value: m.name || '', placeholder: `Member ${i + 1}`, 'aria-label': `Name of member ${i + 1}`, onInput: (e) => { m.name = e.target.value; refresh(); } })),
        h('details', { class: 'tl-per', open: !!(m.workDays || m.daysOff.length) }, h('summary', {}, 'Own schedule (optional)'),
          h('p', { class: 'muted small' }, 'Different days than the team, or personal days off (part-time, leave).'),
          h('div', { class: 'row wrap gap' }, chips),
          h('div', { class: 'row wrap gap' }, offIn, h('button', { type: 'button', class: 'btn sm', onClick: () => { if (offIn.value && !m.daysOff.includes(offIn.value)) { m.daysOff = [...m.daysOff, offIn.value].sort(); paintTeam(); refresh(); } } }, '+ Day off')), off));
    })));
  }
  paintTeam();

  const per = h('details', { class: 'tl-per' }, h('summary', {}, 'Adjust individual sprints (optional)'),
    h('p', { class: 'muted small' }, 'Leave empty to use the default length. Useful for a lighter setup sprint or a heavy one.'),
    h('div', { class: 'tl-per-grid' }, sprints.map((sp) => h('label', {}, h('span', { class: 'chip' }, sprintLabel(sp)), h('span', { class: 'ell' }, sprintName(sp)),
      h('input', { type: 'number', min: 1, max: 60, class: 'num', value: st.perSprint[sp.id] ?? '', placeholder: 'default', onInput: (e) => { const v = Number(e.target.value); v ? (st.perSprint[sp.id] = v) : delete st.perSprint[sp.id]; refresh(); } }), h('span', { class: 'muted small' }, 'days')))));

  const field = (label, hint, ...kids) => h('div', { class: 'tl-field' }, h('div', { class: 'tl-q' }, h('strong', {}, label), hint ? h('span', { class: 'muted small' }, hint) : null), h('div', { class: 'row wrap gap' }, ...kids));
  const form = h('form', { class: 'tl-form', onSubmit: async (e) => {
    e.preventDefault();
    try { const out = await api.planSave(plan(), todayStr()); onSave(out); } catch (x) { err.textContent = x.message; err.hidden = false; }
  } },
    anchorBox,
    h('div', { class: 'tl-field' }, h('div', { class: 'tl-q' }, startQ, startHint), h('div', { class: 'row wrap gap' }, start, h('button', { type: 'button', class: 'btn sm', onClick: () => { start.value = st.startDate = todayStr(); st.rebase = true; refresh(); } }, 'Today'))),
    targetField,
    h('div', { class: 'tl-field' }, h('div', { class: 'tl-q' }, h('strong', {}, 'How many people work on it?'), h('span', { class: 'muted small' }, 'Tickets are split between them automatically, balanced by workload. You can reassign any ticket later.')), h('div', { class: 'row wrap gap' }, teamNum), teamBox),
    field('How long should each sprint take?', 'Default for every sprint. You can tune single sprints below.', lenNum, lenUnit),
    field('Which days do you work on it?', 'Your real days, not the whole week.', ...dayBtns),
    h('div', { class: 'tl-field' }, h('div', { class: 'tl-q' }, h('strong', {}, 'Any days off?'), h('span', { class: 'muted small' }, 'Holidays, trips, exams: skipped automatically.')), h('div', { class: 'row wrap gap' }, offInput, h('button', { type: 'button', class: 'btn sm', onClick: addOff }, '+ Add day off')), offList),
    per, preview, err,
    h('div', { class: 'row gap' }, h('button', { class: 'btn primary', type: 'submit' }, initial ? 'Save and update timeline' : 'Generate my timeline'), onCancel ? h('button', { type: 'button', class: 'btn', onClick: onCancel }, 'Cancel') : null));
  refresh();
  return form;
}

function gantt(sch) {
  const t0 = sch.sprints.map((r) => r.start).sort()[0];
  const t1 = sch.sprints.map((r) => r.end).sort().at(-1);
  const span = Math.max(1, dayDiff(t0, t1) + 1);
  const x = (d) => Math.min(100, Math.max(0, (dayDiff(t0, d) / span) * 100));
  const today = sch.today.date;
  // month ticks
  const ticks = [];
  const cur = parse(t0); cur.setDate(1); cur.setMonth(cur.getMonth() + 1);
  while (cur <= parse(t1)) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`;
    ticks.push(h('span', { class: 'g-tick', style: { left: x(key) + '%' } }, cur.toLocaleDateString(undefined, { month: 'short', year: cur.getMonth() === 0 ? '2-digit' : undefined })));
    cur.setMonth(cur.getMonth() + 1);
  }
  const todayX = today >= t0 && today <= t1 ? x(today) : null;
  return h('div', { class: 'gantt-wrap' }, h('div', { class: 'gantt', role: 'img', 'aria-label': 'Sprint timeline' },
    h('div', { class: 'g-head' }, ticks),
    sch.sprints.map((r, i) => {
      const left = x(r.start);
      const width = Math.max(1.2, x(addOne(r.end)) - left);
      const [, tone] = STATE[r.state];
      return h('div', { class: 'g-row' },
        h('a', { class: 'g-label', href: `#/timeline` , title: r.title }, 'S' + r.id),
        h('div', { class: 'g-track' },
          h('div', { class: 'g-bar ' + tone, style: { left: left + '%', width: width + '%', '--i': i }, title: `${r.title}\n${fmtDate(r.start)} → ${fmtDate(r.end)} · ${r.actualPct}% done (planned ${r.expectedPct}%)` },
            h('i', { style: { width: r.actualPct + '%' } }), h('span', {}, r.actualPct + '%'))));
    }),
    todayX != null ? h('div', { class: 'g-today', style: { left: `calc(46px + (100% - 46px) * ${todayX / 100})` } }, h('span', {}, 'Today')) : null));
}
const addOne = (d) => { const x = parse(d); x.setDate(x.getDate() + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const teamOf = (sch, id) => sch.team.find((m) => m.id === id);

/** Per-person load: totals plus one cell per sprint (steps), so an overloaded sprint is obvious. */
function workload(sch) {
  const max = Math.max(1, ...sch.sprints.flatMap((r) => r.load.map((l) => l.steps)));
  return h('div', { class: 'wl', style: { '--cols': sch.sprints.length } },
    h('div', { class: 'wl-row wl-head' }, h('span', {}), ...sch.sprints.map((r) => h('span', { class: 'wl-c', title: r.title }, 'S' + r.id)), h('span', { class: 'wl-t' }, 'Total')),
    sch.team.map((m) => h('div', { class: 'wl-row' },
      h('span', { class: 'wl-n' }, avatar(m, 'sm'), h('span', { class: 'ell' }, m.name)),
      ...sch.sprints.map((r) => { const l = r.load.find((x) => x.member === m.id); return h('span', { class: 'wl-c', title: `${m.name} · ${r.title}: ${l.tickets} tickets, ${l.steps} steps over ${l.days} day${l.days === 1 ? '' : 's'}` }, h('i', { style: { height: Math.max(l.steps ? 8 : 2, (l.steps / max) * 100) + '%', background: m.color } }), h('b', {}, l.steps || '·')); }),
      h('span', { class: 'wl-t' }, h('strong', {}, `${m.tickets}`), h('span', { class: 'muted small' }, ` tickets · ${m.steps} steps · ${m.days} days`), h('div', { class: 'bar thin' }, h('i', { style: { width: (m.steps ? (m.stepsDone / m.steps) * 100 : 0) + '%', background: m.color } }))))));
}

const ZOOMS = [14, 20, 28, 40, 56, 80];

/** One lane per person; every ticket is a bar. Drag sideways to move it, onto another lane to reassign. */
function taskGantt(sch, { member, ppd, onChange, extras }) {
  const all = sch.sprints.flatMap((r) => r.schedule.map((t) => ({ ...t, sprint: r.id })));
  const t0 = [sch.plan.startDate, ...all.map((t) => t.start)].sort()[0];
  const t1 = [sch.plannedEnd, ...all.map((t) => t.due)].sort().at(-1);
  const days = dayDiff(t0, t1) + 1;
  const W = days * ppd;
  const x = (d) => dayDiff(t0, d) * ppd;
  const today = sch.today.date;
  const lanes = (member ? sch.team.filter((m) => m.id === member) : sch.team);
  const solo = sch.team.length === 1;
  const off = new Set(sch.plan.daysOff);
  const wk = new Set(sch.plan.workDays);

  // time header: months + weeks (+ day numbers when zoomed in)
  const head = h('div', { class: 'tg-head', style: { width: W + 'px' } });
  const shade = h('div', { class: 'tg-shade' });
  for (let i = 0; i < days; i++) {
    const d = addDaysStr(t0, i);
    const dow = parse(d).getDay();
    if (!wk.has(dow) || off.has(d)) shade.append(h('i', { style: { left: i * ppd + 'px', width: ppd + 'px' }, class: off.has(d) ? 'off' : '' }));
    if (ppd >= 28) head.append(h('span', { class: 'tg-d' + (dow === 1 ? ' mon' : ''), style: { left: i * ppd + 'px', width: ppd + 'px' } }, parse(d).getDate()));
    else if (dow === 1) head.append(h('span', { class: 'tg-w', style: { left: i * ppd + 'px' } }, fmtDate(d)));
    if (parse(d).getDate() === 1 || i === 0) head.append(h('span', { class: 'tg-m', style: { left: i * ppd + 'px' } }, parse(d).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })));
  }
  const seps = h('div', { class: 'tg-seps' }, sch.sprints.map((r) => h('div', { class: 'tg-sep', style: { left: x(r.start) + 'px' } }, h('span', {}, 'S' + r.id))));

  const laneEls = lanes.map((m) => {
    const mine = all.filter((t) => t.member === m.id).sort((a, b) => a.start.localeCompare(b.start) || a.due.localeCompare(b.due));
    const tracks = [];
    const place = new Map();
    for (const t of mine) {
      let k = tracks.findIndex((end) => end < t.start);
      if (k < 0) { k = tracks.length; tracks.push(''); }
      tracks[k] = t.due;
      place.set(t.id, k);
    }
    const ROW = 28;
    const body = h('div', { class: 'tg-lane-body', dataset: { lane: m.id }, style: { width: W + 'px', height: Math.max(1, tracks.length) * ROW + 10 + 'px' } },
      mine.map((t) => {
        const w = (dayDiff(t.start, t.due) + 1) * ppd - 3;
        const late = t.status !== 'done' && t.due < today;
        const b = h('div', { class: 'tg-bar ' + t.status + (late ? ' late' : '') + ((t.manual.member || t.manual.due) ? ' pinned' : ''), tabindex: 0, role: 'button', style: { left: x(t.start) + 1 + 'px', width: w + 'px', top: place.get(t.id) * ROW + 5 + 'px' }, title: `${t.id} · ${t.title}\n${STATUS_LABEL[t.status]} · ${t.done}/${t.steps} steps\n${fmtDate(t.start)} → ${fmtDate(t.due)}${m && !solo ? ' · ' + m.name : ''}` },
          h('b', {}, shortId(t.id)), w > 120 ? h('span', {}, t.title) : null);
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(t.id, { onChange }); } });
        b.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          const sx = e.clientX, sy = e.clientY;
          let moved = false;
          let overLane = null;
          const laneAt = (ev) => document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => el.dataset?.lane)?.dataset.lane;
          const move = (ev) => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (!moved && Math.hypot(dx, dy) < 5) return;
            if (!moved) { moved = true; b.classList.add('drag'); b.setPointerCapture(e.pointerId); }
            b.style.transform = `translate(${Math.round(dx / ppd) * ppd}px, ${dy}px)`;
            const ln = laneAt(ev);
            if (ln !== overLane) { overLane = ln; for (const el of laneElsList) el.classList.toggle('drop', !solo && el.dataset.lane === ln && ln !== t.member); }
          };
          const up = async (ev) => {
            b.removeEventListener('pointermove', move); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
            for (const el of laneElsList) el.classList.remove('drop');
            if (!moved) return openDrawer(t.id, { onChange });
            b.classList.remove('drag');
            const dd = Math.round((ev.clientX - sx) / ppd);
            const ln = laneAt(ev);
            const patch = { ticketId: t.id };
            if (dd) { patch.start = addDaysStr(t.start, dd); patch.due = addDaysStr(t.due, dd); }
            if (ln && ln !== t.member && !solo) patch.member = ln;
            if (Object.keys(patch).length === 1) { b.style.transform = ''; return; }
            const prev = { ticketId: t.id, member: t.manual.member ? t.member : null, due: t.manual.due ? t.due : null, start: t.manual.due ? t.start : null };
            try {
              await api.planManual(patch, todayStr());
              toast(`${t.id} ${patch.member ? `→ ${teamOf(sch, patch.member).name}` : ''}${dd ? ` ${dd > 0 ? '+' : ''}${dd} day${Math.abs(dd) === 1 ? '' : 's'}` : ''}`, '', { label: 'Undo', fn: async () => { try { await api.planManual(prev, todayStr()); onChange(); } catch (x) { toast(x.message, 'err'); } } });
            } catch (x) { toast(x.message, 'err'); }
            onChange();
          };
          document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
        });
        return b;
      }));
    return h('div', { class: 'tg-lane' }, solo ? null : h('div', { class: 'tg-lane-h' }, m.kind === 'ai' ? h('span', { class: 'avatar ai sm', style: { '--mc': m.color } }, '✦') : avatar(m, 'sm'), h('strong', {}, m.name), h('span', { class: 'muted small' }, `${m.tickets} tickets · ${m.steps} steps`)), body);
  });
  const laneElsList = laneEls.map((l) => l.querySelector('.tg-lane-body'));
  const body = h('div', { class: 'tg-body', style: { width: W + 'px' } }, shade, seps,
    today >= t0 && today <= t1 ? h('div', { class: 'g-today', style: { left: x(today) + ppd / 2 + 'px', top: 0 } }, h('span', {}, 'Today')) : null, laneEls);
  return h('div', { class: 'tg-scroll' }, h('div', { class: 'tg', style: { width: W + 'px' } }, head, body));
}

const openSet = new Set();
function sprintTable(sch) {
  const multi = sch.team.length > 1;
  return h('div', { class: 'tl-list' }, sch.sprints.map((r) => {
    const [label, tone] = STATE[r.state];
    const body = h('div', { class: 'tl-tickets', hidden: !openSet.has(r.id) }, r.schedule.map((t) =>
      h('a', { class: 'tl-t ' + t.status + (t.status !== 'done' && t.due < sch.today.date ? ' late' : ''), href: `#/t/${encodeURIComponent(t.id)}` },
        h('i', { class: 'dot ' + t.status }), h('span', { class: 'tid' }, shortId(t.id)), h('span', { class: 'grow ell' }, t.title),
        multi ? avatar(teamOf(sch, t.member), 'sm') : null, h('span', { class: 'muted small' }, 'due ' + fmtDate(t.due)))));
    const head = h('button', { class: 'tl-sp', 'aria-expanded': openSet.has(r.id), onClick: () => { body.hidden = !body.hidden; body.hidden ? openSet.delete(r.id) : openSet.add(r.id); head.setAttribute('aria-expanded', !body.hidden); } },
      h('span', { class: 'chip' }, 'S' + r.id), h('span', { class: 'grow ell' }, sprintName(r)),
      h('span', { class: 'muted small tl-dates', title: r.assumed ? 'No real completion date was recorded (marked done in bulk), so this date is an estimate.' : '' }, r.history ? (r.assumed ? 'finished earlier' : `finished ${fmtDate(r.end)}`) : `${fmtDate(r.start)} → ${fmtDate(r.end)} · ${r.days}d`),
      h('span', { class: 'muted small tl-pct' }, `${r.actualPct}% / plan ${r.expectedPct}%`),
      h('span', { class: 'st-pill ' + tone }, label));
    return h('div', { class: 'tl-item' }, head, body);
  }));
}

export async function timelineView(root) {
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Timeline — Tutorial Tracker';
  const data = await api.plan(todayStr());
  const again = () => timelineView(root);

  if (!data.plan) {
    root.replaceChildren(h('div', { class: 'dash' },
      h('h1', { class: 'page-title' }, 'Plan your timeline'),
      h('section', { class: 'card tl-wizard' },
        h('p', { class: 'muted' }, 'Answer a few questions and I\'ll lay your sprints and tickets on a calendar, split the work between your team, and check whether you are ahead or behind. You can change any answer later.'),
        planForm(null, again))));
    return enter(root);
  }

  const sch = data.schedule;
  const td = sch.today;
  const multi = sch.team.length > 1;
  const delta = td.deltaSteps;
  const allDone = sch.projectedEnd === 'done';
  const worst = sch.sprints.some((r) => r.state === 'overdue') ? 'overdue' : delta < -Math.max(5, td.totalSteps * 0.03) ? 'behind' : delta > Math.max(5, td.totalSteps * 0.03) ? 'ahead' : 'on-track';
  const tile = (icon, label, value, sub, tone = '') => h('div', { class: 'tile-stat tl-tile ' + tone }, h('span', { class: 'ts-ic' }, icon), h('div', {}, h('div', { class: 'stat-l' }, label), h('div', { class: 'stat-v sm' }, value), sub ? h('div', { class: 'muted small' }, sub) : null));
  const projDiff = sch.projectedEnd && !allDone ? dayDiff(sch.plannedEnd, sch.projectedEnd) : null;
  const manualCount = Object.keys(sch.plan.manual).length;

  let mode = ['roadmap', 'lanes', 'calendar', 'agenda', 'sprints'].includes(ls('tlMode2')) ? ls('tlMode2') : window.innerWidth < 700 ? 'agenda' : 'roadmap';
  let member = '';
  let zoom = Math.max(0, Math.min(ZOOMS.length - 1, Number(ls('tlZoom') ?? 2)));
  const extras = await api.extras().catch(() => ({}));
  const first = sch.sprints.findIndex((r) => !r.history);
  const rm = { ppd: ls('rmPpd') ? Number(ls('rmPpd')) : 30, open: new Set(sch.sprints.slice(Math.max(0, first), Math.max(0, first) + 2).map((r) => r.id)), first: true };
  const cal = { month: sch.today.date.slice(0, 8) + '01', expanded: null };
  const view = h('div', {});
  const open = (id) => openDrawer(id, { onChange: () => again() });
  const paint = () => {
    const zbtn = (k, label) => h('button', { type: 'button', class: Math.round(rm.ppd) === ({ month: 8, week: 18, day: 34 })[k] ? 'on' : '', onClick: () => { rm.setZoom(({ month: 8, week: 18, day: 34 })[k]); ls('rmPpd', rm.ppd); paint(); } }, label);
    const toolbar = h('div', { class: 'tl-bar' },
      h('div', { class: 'seg', role: 'tablist' }, [['roadmap', '▦ Roadmap'], ['lanes', '☰ Team lanes'], ['calendar', '▤ Calendar'], ['agenda', '☑ Agenda'], ['sprints', '▭ Sprints']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': mode === k, class: mode === k ? 'on' : '', onClick: () => { mode = k; ls('tlMode2', k); paint(); } }, l))),
      mode === 'lanes' && multi ? h('div', { class: 'row wrap gap' }, h('button', { class: 'daychip sm' + (!member ? ' on' : ''), onClick: () => { member = ''; paint(); } }, 'Everyone'), sch.team.map((m) => h('button', { class: 'daychip sm' + (member === m.id ? ' on' : ''), style: { '--mc': m.color }, onClick: () => { member = member === m.id ? '' : m.id; paint(); } }, avatar(m, 'xs'), m.name))) : null,
      h('span', { class: 'grow' }),
      mode === 'roadmap' ? h('div', { class: 'row gap wrap' },
        h('div', { class: 'seg sm' }, zbtn('month', 'Month'), zbtn('week', 'Week'), zbtn('day', 'Day'), h('button', { type: 'button', onClick: () => { rm.fit(); paint(); } }, 'Fit')),
        h('button', { class: 'btn sm', type: 'button', onClick: () => rm.toToday() }, '◎ Today'),
        h('button', { class: 'btn sm', type: 'button', title: 'Expand or collapse every sprint', onClick: () => { rm.open.size >= sch.sprints.length ? rm.open.clear() : sch.sprints.forEach((r) => rm.open.add(r.id)); rm.render(true); } }, '⇕')) : null,
      mode === 'lanes' ? h('div', { class: 'row gap' }, h('button', { class: 'btn sm', title: 'Zoom out', disabled: zoom === 0, onClick: () => { zoom--; ls('tlZoom', zoom); paint(); } }, '−'), h('button', { class: 'btn sm', title: 'Zoom in', disabled: zoom === ZOOMS.length - 1, onClick: () => { zoom++; ls('tlZoom', zoom); paint(); } }, '+')) : null,
      manualCount ? h('button', { class: 'link', title: 'Remove every manual owner/date change', onClick: async () => { if (confirm(`Reset ${manualCount} manual change${manualCount === 1 ? '' : 's'} to the automatic plan?`)) { await api.planManualClear(); again(); } } }, `↺ Reset ${manualCount} manual change${manualCount === 1 ? '' : 's'}`) : null);
    const hint = (t) => h('div', { class: 'muted small tl-hint' }, t);
    view.replaceChildren(h('section', { class: 'card tl-card' + (mode === 'roadmap' ? ' flush' : '') }, toolbar,
      mode === 'roadmap' ? h('div', {}, roadmap(sch, { extras, openTicket: open, onChange: again, state: rm }), hint('Click a sprint to fold it. Click a bar to open the task drawer, drag it to move it, drag its edges to change the dates. ◆ = sprint end, orange tick = where the plan says you should be. Hatched bars were finished earlier.'))
      : mode === 'lanes' ? h('div', {}, taskGantt(sch, { member, ppd: ZOOMS[zoom], onChange: again, extras }), hint('Each bar is a ticket. Click to open it, drag sideways to move it' + (multi ? ', or drop it on another lane to reassign (for example to Claude).' : '.') + ' Shaded days are days off. 📌 = changed by you.'))
      : mode === 'calendar' ? calendar(sch, { extras, openTicket: open, state: cal })
      : mode === 'agenda' ? agenda(sch, { extras, openTicket: open })
      : h('div', {}, gantt(sch), hint('Bars show the planned window of each sprint; the fill is your real progress. Days off and non-working days are skipped.'))));
  };
  paint();

  const edit = () => {
    const m = openModal(h('div', { class: 'pad' }, h('h2', {}, 'Edit your plan'), planForm(data.plan, () => { m.close(true); toast('Timeline updated'); again(); }, () => m.close())), { wide: true, label: 'Edit plan' });
  };
  const reset = async () => {
    if (!confirm('Remove the plan? Your progress is not affected. You can generate a new timeline afterwards.')) return;
    await api.planClear();
    again();
  };

  root.replaceChildren(h('div', { class: 'dash' },
    h('div', { class: 'sec-head' }, h('h1', { class: 'page-title' }, 'Timeline'), h('div', { class: 'row gap' }, h('a', { class: 'btn', href: '#/board' }, '▦ Board'), h('button', { class: 'btn', onClick: edit }, '✎ Edit plan'), h('button', { class: 'link', onClick: reset }, 'Remove plan'))),
    h('section', { class: 'stats tl-stats' },
      tile('🏁', 'Planned finish', fmtDate(sch.plannedEnd, true), `${multi ? `team of ${sch.team.length} · ` : ''}${plural(sch.sprints.length, 'sprint')} · ${plural(sch.workDaysTotal, 'working day')} · ≈ ${plural(sch.weeks, 'week')}`),
      tile('📈', 'At your pace', allDone ? 'Finished 🎉' : sch.projectedEnd ? fmtDate(sch.projectedEnd, true) : 'Not enough data yet', allDone ? '' : sch.projectedEnd ? ((projDiff > 0 ? `${plural(projDiff, 'day')} later than planned` : projDiff < 0 ? `${plural(-projDiff, 'day')} earlier than planned` : 'right on plan') + (sch.forecast?.fast && sch.forecast?.slow && sch.forecast.fast !== sch.forecast.slow ? ` · range ${fmtDate(sch.forecast.fast)} – ${fmtDate(sch.forecast.slow)}` : '')) : 'needs a few working days of progress', projDiff > 0 ? 'late' : ''),
      tile(worst === 'behind' || worst === 'overdue' ? '🐢' : worst === 'ahead' ? '🚀' : '🎯', 'Today vs plan', delta === 0 ? 'On plan' : `${delta > 0 ? '+' : ''}${delta} steps`, `${td.actualSteps} done · plan says ${td.expectedSteps}`, worst),
      tile('📌', td.isWorkday ? 'Due by today' : 'Due so far', plural(td.dueTickets, 'ticket'), td.overdue ? `${td.overdue} overdue` : td.dueTickets ? 'due today or earlier' : 'nothing pending', td.overdue ? 'late' : '')),
    view,
    multi ? h('section', { class: 'card' }, h('h3', {}, 'Team workload'), workload(sch), h('div', { class: 'muted small' }, 'Steps per person per sprint (bar height) and in total. The split balances steps per available day, so people with fewer working days get fewer tickets.')) : null,
    td.next.length ? h('section', { class: 'card' }, h('h3', {}, 'Coming up'), h('div', { class: 'list' }, td.next.map((t) => h('a', { class: 'row-link', href: `#/t/${encodeURIComponent(t.id)}` }, h('i', { class: 'dot ' + t.status }), h('span', { class: 'chip' }, t.id), h('span', { class: 'grow ell' }, t.title), multi ? avatar(teamOf(sch, t.member), 'sm') : null, h('span', { class: 'muted small' + (t.due < td.date ? ' late-t' : '') }, (t.due < td.date ? 'was due ' : 'due ') + fmtDate(t.due)))))) : null,
    h('section', { class: 'card' }, h('h3', {}, 'Sprint by sprint'), sprintTable(sch))));
  enter(root);
}

