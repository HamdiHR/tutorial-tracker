// Timeline views built on the computed schedule: Gantt roadmap, agenda and month calendar.
import { h, toast } from './dom.js';
import { api } from './api.js';
import { ls, sprintName, shortId, STATUS_LABEL } from './state.js';
import { todayStr, parse, fmtDate, dayDiff, addDaysStr, plural } from './dates.js';
import { avatar } from './ui.js';
import { labelClass, PRIORITY } from './drawer.js';

const ROW = 34;
const LABEL_W = 300;
const memberOf = (sch, id) => sch.team.find((m) => m.id === id) || sch.team[0];
const who = (m, cls = 'xs') => (m?.kind === 'ai' ? h('span', { class: 'avatar ai ' + cls, style: { '--mc': m.color }, title: m.name + ' (AI assistant)' }, '✦') : avatar(m, cls));

/** Small decorations shared by bars, agenda rows and calendar chips. */
export function badges(ex) {
  if (!ex) return [];
  const out = [];
  if (ex.p) out.push(h('span', { class: 'bd prio-' + ex.p, title: PRIORITY[ex.p] + ' priority' }, '⚑'));
  if (ex.st) out.push(h('span', { class: 'bd', title: `${ex.sd} of ${ex.st} subtasks` }, `☑ ${ex.sd}/${ex.st}`));
  if (ex.fn) out.push(h('span', { class: 'bd', title: plural(ex.fn, 'file') }, `📎 ${ex.fn}`));
  return out;
}

/* ───────────── Gantt roadmap ───────────── */
const ZOOM = { month: 5, week: 14, day: 34 };

export function roadmap(sch, { extras = {}, openTicket, onChange, state }) {
  const today = sch.today.date;
  const rows = sch.sprints;
  const all = rows.flatMap((r) => r.schedule);
  const t0 = addDaysStr([sch.plan.startDate, ...rows.map((r) => r.start), ...all.map((t) => t.start)].sort()[0], -3);
  const t1 = addDaysStr([sch.plannedEnd, ...rows.map((r) => r.end), ...all.map((t) => t.due), today].sort().at(-1), 5);
  const days = dayDiff(t0, t1) + 1;
  const off = new Set(sch.plan.daysOff);
  const wk = new Set(sch.plan.workDays);
  const solo = sch.team.length === 1;
  const wrap = h('div', { class: 'rm' });
  const scroller = h('div', { class: 'rm-scroll', tabindex: 0, 'aria-label': 'Roadmap' });

  const build = () => {
    const ppd = state.ppd;
    const W = days * ppd;
    const x = (d) => dayDiff(t0, d) * ppd;
    const open = state.open;

    // header: months over weeks/days
    const head = h('div', { class: 'rm-axis', style: { width: W + 'px' } });
    const shade = h('div', { class: 'rm-shade' });
    for (let i = 0; i < days; i++) {
      const d = addDaysStr(t0, i);
      const dt = parse(d);
      const dow = dt.getDay();
      if (!wk.has(dow) || off.has(d)) shade.append(h('i', { class: off.has(d) ? 'off' : '', style: { left: i * ppd + 'px', width: ppd + 'px' } }));
      if (ppd >= 28) head.append(h('span', { class: 'rm-d' + (dow === 1 ? ' mon' : '') + (d === today ? ' now' : ''), style: { left: i * ppd + 'px', width: ppd + 'px' } }, dt.getDate()));
      else if (dow === 1) head.append(h('span', { class: 'rm-w', style: { left: i * ppd + 'px' } }, ppd >= 10 ? fmtDate(d) : dt.getDate()));
      if (dt.getDate() === 1 || i === 0) head.append(h('span', { class: 'rm-m', style: { left: i * ppd + 'px' } }, dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })));
    }

    const body = h('div', { class: 'rm-body', style: { width: W + 'px' } });
    const list = [];
    const pos = new Map();
    for (const r of rows) {
      const isOpen = open.has(r.id);
      const pct = r.actualPct;
      const [sx, ex] = [x(r.start), x(r.end) + ppd];
      list.push(h('div', { class: 'rm-row rm-sp' + (r.history ? ' is-past' : '') + ' st-' + r.state },
        h('button', { class: 'rm-label', type: 'button', 'aria-expanded': isOpen, onClick: () => { isOpen ? open.delete(r.id) : open.add(r.id); render(true); } },
          h('span', { class: 'caret' }, isOpen ? '▾' : '▸'), h('span', { class: 'chip' }, 'S' + r.id), h('span', { class: 'ell grow' }, sprintName(r)), h('span', { class: 'muted small' }, r.history ? '✓' : `${r.actualPct}%`)),
        h('div', { class: 'rm-track', style: { width: W + 'px' } },
          h('div', { class: 'rm-band', style: { left: sx + 'px', width: Math.max(ppd, ex - sx) + 'px' }, title: `${r.title}\n${r.history ? (r.assumed ? 'finished earlier' : 'finished ' + fmtDate(r.end)) : fmtDate(r.start) + ' → ' + fmtDate(r.end) + ' · ' + plural(r.days, 'day')}\n${r.actualPct}% done · plan ${r.expectedPct}%` },
            h('i', { style: { width: pct + '%' } }),
            !r.history ? h('u', { style: { left: r.expectedPct + '%' }, title: `Plan says ${r.expectedPct}% by today` }) : null,
            ex - sx > 90 ? h('span', {}, r.history ? 'finished' : `${r.actualPct}% · plan ${r.expectedPct}%`) : null),
          h('div', { class: 'rm-ms', style: { left: ex - 1 + 'px' }, title: 'Sprint end ' + fmtDate(r.end) }, '◆'))));
      if (!isOpen) continue;
      for (const t of r.schedule) {
        const m = memberOf(sch, t.member);
        const ex2 = extras[t.id];
        const late = t.status !== 'done' && t.due < today;
        const left = x(t.start) + 1, width = Math.max(10, (dayDiff(t.start, t.due) + 1) * ppd - 3);
        const prog = t.steps ? Math.round((t.done / t.steps) * 100) : t.status === 'done' ? 100 : 0;
        const pinned = t.manual?.member || t.manual?.due;
        const bar = h('div', { class: 'rm-bar ' + t.status + (late ? ' late' : '') + (t.history ? ' is-past' : '') + (pinned ? ' pinned' : '') + (m?.kind === 'ai' ? ' ai' : ''), tabindex: 0, role: 'button', style: { left: left + 'px', width: width + 'px', '--mc': m?.color || 'var(--accent)' },
          title: `${t.id} · ${t.title}\n${STATUS_LABEL[t.status]} · ${t.done}/${t.steps} steps${t.history ? (t.assumed ? '\nfinished earlier' : '') : `\n${fmtDate(t.start)} → ${fmtDate(t.due)}`}${solo ? '' : '\n' + (m?.name || '')}${ex2?.b ? '\nBlocked: ' + ex2.b : ''}` },
          h('i', { class: 'fill', style: { width: prog + '%' } }),
          width > 150 ? h('span', { class: 'rm-bt' }, t.title) : width > 40 ? h('span', { class: 'rm-bt' }, shortId(t.id)) : null,
          !t.history ? h('s', { class: 'hl', 'data-side': 'l' }) : null, !t.history ? h('s', { class: 'hr', 'data-side': 'r' }) : null);
        if (!t.history) bindDrag(bar, t, ppd, { openTicket, onChange });
        else bar.addEventListener('click', () => openTicket(t.id));
        bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTicket(t.id); } });
        pos.set(t.id, { row: list.length, l: left, r: left + width, t });
        list.push(h('div', { class: 'rm-row rm-tk' },
          h('button', { class: 'rm-label tk', type: 'button', onClick: () => openTicket(t.id), title: t.title },
            h('i', { class: 'dot ' + t.status }), h('span', { class: 'tid' }, shortId(t.id)), h('span', { class: 'ell grow' }, t.title), ...badges(ex2).slice(0, 2), solo ? null : who(m)),
          h('div', { class: 'rm-track', style: { width: W + 'px' } }, bar,
            width < 150 || ex2?.l?.length ? h('div', { class: 'rm-after', style: { left: left + width + 6 + 'px' } }, width < 150 ? h('span', { class: 'rm-at' }, t.title) : null, ...(ex2?.l || []).slice(0, 3).map((l) => h('span', { class: labelClass(l) + ' on' }, l))) : null)));
      }
    }
    const bodyH = list.length * ROW;
    // dependency arrows: from the end of the task that must finish first to the start of the task that waits for it
    const NS = 'http://www.w3.org/2000/svg';
    const arrows = document.createElementNS(NS, 'svg');
    arrows.setAttribute('class', 'rm-deps'); arrows.setAttribute('width', W); arrows.setAttribute('height', bodyH);
    let nDeps = 0;
    for (const [id, to] of pos) for (const dep of extras[id]?.dp || []) {
      const from = pos.get(dep); if (!from) continue;
      const clash = from.t.status !== 'done' && from.t.due >= to.t.start;
      const y1 = from.row * ROW + ROW / 2, y2 = to.row * ROW + ROW / 2, x1 = from.r, x2 = to.l, mx = Math.max(x1 + 8, x2 - 8);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x1} ${y1} H${mx} V${y2} H${x2 - 2}`); p.setAttribute('class', 'rm-dep' + (clash ? ' clash' : '') + (from.t.status === 'done' ? ' ok' : ''));
      p.setAttribute('marker-end', clash ? 'url(#rmArrowBad)' : 'url(#rmArrow)');
      const tt = document.createElementNS(NS, 'title'); tt.textContent = `${shortId(dep)} → ${shortId(id)}${clash ? ' (conflict: the first task is planned to end after the second starts)' : ''}`; p.append(tt);
      arrows.append(p); nDeps++;
    }
    if (nDeps) arrows.insertAdjacentHTML('afterbegin', '<defs><marker id="rmArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="rm-ah"/></marker><marker id="rmArrowBad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="rm-ah bad"/></marker></defs>');
    body.append(...[shade, nDeps ? arrows : null,
      ...rows.filter((r) => !r.history).map((r) => h('div', { class: 'rm-vline', style: { left: x(r.start) + 'px', height: bodyH + 'px' } })),
      today >= t0 && today <= t1 ? h('div', { class: 'rm-today', style: { left: x(today) + ppd / 2 + 'px', height: bodyH + 'px' } }, h('span', {}, 'Today')) : null,
      sch.projectedEnd && sch.projectedEnd !== 'done' && sch.projectedEnd >= t0 && sch.projectedEnd <= t1 ? h('div', { class: 'rm-forecast', style: { left: x(sch.projectedEnd) + 'px', height: bodyH + 'px' } }, h('span', {}, 'Forecast')) : null].filter(Boolean));
    const frag = h('div', { class: 'rm-grid', style: { '--lw': LABEL_W + 'px', width: LABEL_W + W + 'px' } },
      h('div', { class: 'rm-row rm-head' }, h('div', { class: 'rm-label corner' }, h('strong', {}, 'Sprint / ticket')), head),
      h('div', { class: 'rm-rows' }, h('div', { class: 'rm-bgwrap', style: { left: LABEL_W + 'px' } }, body), ...list));
    return { frag, x, W };
  };

  let last = null;
  let render = (keep = false) => {
    const sl = scroller.scrollLeft, st = scroller.scrollTop;
    last = build();
    scroller.replaceChildren(last.frag);
    if (keep) { scroller.scrollLeft = sl; scroller.scrollTop = st; }
  };
  state.render = render;
  state.toToday = () => { const px = last.x(today) - (scroller.clientWidth - LABEL_W) / 2; scroller.scrollTo({ left: Math.max(0, px), behavior: 'smooth' }); };
  state.fit = () => { state.ppd = Math.max(2, Math.min(34, (scroller.clientWidth - LABEL_W - 8) / days)); render(); scroller.scrollLeft = 0; };
  state.setZoom = (z) => { const c = scroller.scrollLeft + (scroller.clientWidth - LABEL_W) / 2; const dayAtCenter = (c) / state.ppd; state.ppd = z; render(); scroller.scrollLeft = dayAtCenter * z - (scroller.clientWidth - LABEL_W) / 2; };
  // minimap: the whole plan squeezed into one strip; the frame is what you see now. Click or drag to move.
  const mini = h('div', { class: 'rm-mini', role: 'slider', 'aria-label': 'Timeline overview. Click or drag to scroll.', tabindex: 0 });
  const frame = h('div', { class: 'rm-mini-view' });
  const paintMini = () => {
    mini.replaceChildren(...rows.map((r) => h('i', { class: 'mm-sp st-' + r.state + (r.history ? ' is-past' : ''), style: { left: (dayDiff(t0, r.start) / days) * 100 + '%', width: Math.max(0.6, ((dayDiff(r.start, r.end) + 1) / days) * 100) + '%' }, title: `${r.title} · ${r.actualPct}%` })),
      today >= t0 && today <= t1 ? h('b', { class: 'mm-today', style: { left: (dayDiff(t0, today) / days) * 100 + '%' } }) : null, frame);
    syncMini();
  };
  const syncMini = () => {
    if (!last) return;
    const total = last.W, vis = Math.max(0, scroller.clientWidth - LABEL_W);
    frame.style.left = Math.min(100, (scroller.scrollLeft / total) * 100) + '%';
    frame.style.width = Math.min(100, (vis / total) * 100) + '%';
    mini.classList.toggle('off', total <= vis + 4);
  };
  const jump = (e) => { const r = mini.getBoundingClientRect(); const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); scroller.scrollLeft = frac * last.W - (scroller.clientWidth - LABEL_W) / 2; };
  mini.addEventListener('pointerdown', (e) => { mini.setPointerCapture(e.pointerId); jump(e); const mv = (ev) => jump(ev); const up = () => { mini.removeEventListener('pointermove', mv); mini.removeEventListener('pointerup', up); }; mini.addEventListener('pointermove', mv); mini.addEventListener('pointerup', up); });
  mini.addEventListener('keydown', (e) => { const step = (scroller.clientWidth - LABEL_W) * 0.5; if (e.key === 'ArrowRight') { e.preventDefault(); scroller.scrollLeft += step; } if (e.key === 'ArrowLeft') { e.preventDefault(); scroller.scrollLeft -= step; } });
  scroller.addEventListener('scroll', syncMini, { passive: true });
  const baseRender = render;
  render = (keep) => { baseRender(keep); paintMini(); };
  state.render = render;
  render();
  wrap.append(mini, scroller);
  try { new ResizeObserver(() => syncMini()).observe(scroller); } catch {}
  requestAnimationFrame(syncMini);
  requestAnimationFrame(() => { if (state.first) { state.first = false; scroller.scrollLeft = Math.max(0, last.x(today) - (scroller.clientWidth - LABEL_W) * 0.3); } });
  return wrap;

  function bindDrag(bar, t, ppd, { openTicket, onChange }) {
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const side = e.target.dataset?.side || 'm';
      const sx = e.clientX;
      let moved = false;
      const delta = (ev) => Math.round((ev.clientX - sx) / state.ppd);
      const move = (ev) => {
        const dx = ev.clientX - sx;
        if (!moved && Math.abs(dx) < 4) return;
        if (!moved) { moved = true; bar.classList.add('drag'); }
        let dd = delta(ev);
        const len = dayDiff(t.start, t.due);
        if (side === 'l') dd = Math.min(dd, len);
        if (side === 'r') dd = Math.max(dd, -len);
        const px = dd * state.ppd;
        if (side === 'm') bar.style.transform = `translateX(${px}px)`;
        else if (side === 'l') { bar.style.transform = `translateX(${px}px)`; bar.style.width = parseFloat(bar.style.width) - px + 'px'; bar.dataset.w = '1'; }
        else bar.style.width = Math.max(10, (len + 1 + dd) * state.ppd - 3) + 'px';
        bar.dataset.dd = dd;
      };
      const up = async () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        if (!moved) return openTicket(t.id);
        bar.classList.remove('drag');
        const dd = Number(bar.dataset.dd || 0);
        if (!dd) return state.render(true);
        const patch = { ticketId: t.id };
        if (side === 'm') { patch.start = addDaysStr(t.start, dd); patch.due = addDaysStr(t.due, dd); }
        else if (side === 'l') { patch.start = addDaysStr(t.start, dd); patch.due = t.due; }
        else { patch.start = t.start; patch.due = addDaysStr(t.due, dd); }
        const prev = { ticketId: t.id, due: t.manual?.due ? t.due : null, start: t.manual?.due ? t.start : null };
        try {
          await api.planManual(patch, todayStr());
          toast(`${t.id} ${side === 'm' ? 'moved' : side === 'l' ? 'starts' : 'ends'} ${dd > 0 ? '+' : ''}${plural(dd, 'day')}`, '', { label: 'Undo', fn: async () => { try { await api.planManual(prev, todayStr()); onChange(); } catch (x) { toast(x.message, 'err'); } } });
        } catch (x) { toast(x.message, 'err'); }
        onChange();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
  }
}

/* ───────────── Agenda ───────────── */
export function agenda(sch, { extras = {}, openTicket }) {
  const today = sch.today.date;
  const solo = sch.team.length === 1;
  const items = sch.sprints.flatMap((r) => r.schedule.filter((t) => !t.history && t.status !== 'done').map((t) => ({ ...t, sprint: r.id })));
  const dow = parse(today).getDay();
  const weekEnd = addDaysStr(today, (7 - dow) % 7);
  const nextEnd = addDaysStr(weekEnd, 7);
  const groups = [['Overdue', (t) => t.due < today, 'late'], ['Today', (t) => t.due === today], ['Tomorrow', (t) => t.due === addDaysStr(today, 1)], ['This week', (t) => t.due > addDaysStr(today, 1) && t.due <= weekEnd], ['Next week', (t) => t.due > weekEnd && t.due <= nextEnd], ['Later', (t) => t.due > nextEnd]];
  const used = new Set();
  const out = [];
  for (const [name, f, tone] of groups) {
    const g = items.filter((t) => !used.has(t.id) && f(t)).sort((a, b) => a.due.localeCompare(b.due) || (extras[b.id]?.p || 0) - (extras[a.id]?.p || 0));
    g.forEach((t) => used.add(t.id));
    if (!g.length) continue;
    const later = name === 'Later';
    const shown = later ? g.slice(0, 12) : g;
    out.push(h('section', { class: 'ag-group ' + (tone || '') }, h('h3', {}, name, h('span', { class: 'muted small' }, ` ${g.length}`)),
      ...shown.map((t) => agendaRow(t, sch, extras[t.id], solo, openTicket)), later && g.length > 12 ? h('div', { class: 'muted small ag-more' }, `+ ${g.length - 12} more further out`) : null));
  }
  return out.length ? h('div', { class: 'agenda' }, ...out) : h('div', { class: 'empty' }, h('p', {}, '🎉 Nothing left on the plan.'));
}
function agendaRow(t, sch, ex, solo, openTicket) {
  const m = memberOf(sch, t.member);
  return h('button', { class: 'ag-row', type: 'button', onClick: () => openTicket(t.id) },
    h('i', { class: 'dot ' + t.status }), h('span', { class: 'tid' }, shortId(t.id)), h('span', { class: 'grow ell' }, t.title), ...(ex?.l || []).slice(0, 2).map((l) => h('span', { class: labelClass(l) + ' on' }, l)), ...badges(ex), solo ? null : who(m), h('span', { class: 'muted small ag-due' }, fmtDate(t.due)));
}

/* ───────────── Month calendar ───────────── */
export function calendar(sch, { extras = {}, openTicket, state }) {
  const today = sch.today.date;
  const off = new Set(sch.plan.daysOff);
  const wk = new Set(sch.plan.workDays);
  const items = sch.sprints.flatMap((r) => r.schedule.filter((t) => !t.history).map((t) => ({ ...t, sprint: r.id })));
  const byDay = new Map();
  for (const t of items) (byDay.get(t.due) || byDay.set(t.due, []).get(t.due)).push(t);
  const wrap = h('div', { class: 'cal' });
  const draw = () => {
    const first = state.month; // yyyy-mm-01
    const start = parse(first);
    const lead = (start.getDay() + 6) % 7; // Monday first
    const dim = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < Math.ceil((lead + dim) / 7) * 7; i++) {
      const d = addDaysStr(first, i - lead);
      const dt = parse(d);
      const inMonth = dt.getMonth() === start.getMonth();
      const list = (byDay.get(d) || []).sort((a, b) => (extras[b.id]?.p || 0) - (extras[a.id]?.p || 0));
      const expanded = state.expanded === d;
      const shown = expanded ? list : list.slice(0, 3);
      cells.push(h('div', { class: 'cal-c' + (inMonth ? '' : ' out') + (d === today ? ' today' : '') + (!wk.has(dt.getDay()) ? ' we' : '') + (off.has(d) ? ' off' : '') },
        h('span', { class: 'cal-n' }, dt.getDate()),
        ...shown.map((t) => { const m = memberOf(sch, t.member); return h('button', { class: 'cal-t ' + t.status + (t.status !== 'done' && t.due < today ? ' late' : ''), type: 'button', style: { '--mc': m?.color }, title: `${t.id} · ${t.title}`, onClick: () => openTicket(t.id) }, shortId(t.id), ' ', t.title); }),
        list.length > 3 ? h('button', { class: 'cal-more', type: 'button', onClick: () => { state.expanded = expanded ? null : d; draw(); } }, expanded ? 'show less' : `+${list.length - 3} more`) : null));
    }
    const step = (n) => { const d = parse(first); d.setMonth(d.getMonth() + n); state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; state.expanded = null; draw(); };
    wrap.replaceChildren(
      h('div', { class: 'cal-head' }, h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Previous month', onClick: () => step(-1) }, '‹'), h('strong', {}, start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Next month', onClick: () => step(1) }, '›'), h('button', { class: 'btn sm', type: 'button', onClick: () => { state.month = today.slice(0, 8) + '01'; draw(); } }, 'Today')),
      h('div', { class: 'cal-grid' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => h('div', { class: 'cal-dow' }, n)), ...cells));
  };
  draw();
  return wrap;
}
