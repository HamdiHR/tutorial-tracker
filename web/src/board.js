import { h, toast, debounce } from './dom.js';
import { api } from './api.js';
import { S, ls, sprintLabel, sprintName, shortId } from './state.js';
import { refreshOverview, patchTicket } from './sidebar.js';
import { ticketComplete } from './fx.js';
import { todayStr, fmtDate } from './dates.js';
import { avatar } from './ui.js';
import { enter, reduceMotion } from './motion.js';
import { openDrawer, labelClass, PRIORITY } from './drawer.js';

// column key -> label, and the API status it applies
const COLS = [
  { key: 'todo', label: 'Pending', api: 'pending', hint: 'Not started' },
  { key: 'doing', label: 'Ongoing', api: 'doing', hint: 'In progress' },
  { key: 'done', label: 'Done', api: 'done', hint: 'All steps ticked' },
  { key: 'blocked', label: 'Blocked', api: 'blocked', hint: 'Waiting on something' },
  { key: 'test', label: 'Test & fixes', api: 'test', hint: 'Verify, fix, polish' },
];
const byKey = Object.fromEntries(COLS.map((c) => [c.key, c]));
const hue = (i) => (215 + i * 41) % 360;
const restoreValue = (t) => (t.override === 'todo' ? 'pending' : t.override || null);
const CAP = 30; // cards built per column at first; "Show more" adds more
const CAP_STEP = 50;

/** One small floating menu shared by every card (instead of two <select>s per card). */
function openMenu(anchor, title, items, onPick) {
  document.querySelector('.pop-menu')?.remove();
  const m = h('div', { class: 'pop-menu', role: 'menu', 'aria-label': title },
    h('div', { class: 'pm-title' }, title),
    items.map((it) => h('button', { role: 'menuitem', class: it.active ? 'on' : '', onClick: () => { close(); onPick(it.value); } }, it.dot ? h('i', { class: 'dot ' + it.dot }) : null, it.label, it.active ? h('span', { class: 'muted small' }, '  current') : null)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, hh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + hh + 12 > innerHeight ? Math.max(8, r.top - hh - 4) : r.bottom + 4) + 'px';
  const onDoc = (e) => { if (!m.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { m.remove(); document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('hashchange', close); }
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  m.querySelector('button.on, button')?.focus();
}

export async function boardView(root) {
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Board — Tutorial Tracker';
  const [ov, planData, extras0, myViews0] = await Promise.all([refreshOverview(), api.plan(todayStr()).catch(() => ({ plan: null })), api.extras().catch(() => ({})), api.views().catch(() => [])]);
  let myViews = myViews0;
  let extras = extras0;
  let sch = planData.schedule;
  const team = sch?.team || [];
  const multi = team.length > 1;
  const plan = new Map(); // ticket id -> {member, due, manual}
  const loadPlan = (s) => { plan.clear(); for (const r of s?.sprints || []) for (const t of r.schedule) plan.set(t.id, t); };
  loadPlan(sch);
  const member = (id) => team.find((m) => m.id === id);

  const tickets = [];
  ov.sprints.forEach((sp, i) => { for (const t of sp.items) if (t.kind === 'ticket' && !t.deferred) tickets.push({ ...t, sprint: sp, hue: hue(i) }); });
  const byId = new Map(tickets.map((t) => [t.id, t]));

  const GROUPS = { '': 'No grouping', sprint: 'Group by sprint', who: 'Group by assignee', prio: 'Group by priority' };
  const VIEWS = { '': 'All tickets', late: 'Late', blocked: 'Blocked', high: 'High priority', review: '✦ Claude done · needs review', claude: '✦ Assigned to Claude', mine: 'Assigned to me' };
  const f = { sprint: ls('bdSprint') || '', who: ls('bdWho') || '', q: (() => { const v = ls('bdQ') || ''; if (v) ls('bdQ', ''); return v; })(), group: ls('bdGroup') in GROUPS ? ls('bdGroup') || '' : ls('bdLanes') === '1' ? 'sprint' : '', view: ls('bdView') in VIEWS ? ls('bdView') || '' : '', hideDone: ls('bdHideDone') === '1', compact: ls('bdCompact') === '1' };
  if (f.group && !GROUPS[f.group]) f.group = '';
  const wip = (key) => Number(ls('bdWip.' + key)) || 0;
  const collapsed = (key) => ls('bdCol.' + key) === '1';
  const hasLabel = (t, l) => (extras[t.id]?.l || []).some((x) => x.toLowerCase() === l);
  if (f.sprint && !ov.sprints.some((s) => s.id === f.sprint)) f.sprint = '';
  if (f.who && !member(f.who)) f.who = '';

  const wrap = h('div', { class: 'board-wrap' });
  const summary = h('div', { class: 'bd-sum' });
  const stage = h('div', {});
  const caps = new Map(); // body key -> cards shown
  let bodies = new Map(); // body key -> element
  let counters = new Map(); // column key (+lane) -> count element

  const isAi = (id) => member(id)?.kind === 'ai';
  const viewOk = (t) => {
    const p = plan.get(t.id);
    switch (f.view) {
      case 'late': return !!p && t.status !== 'done' && p.due < todayStr();
      case 'blocked': return t.status === 'blocked';
      case 'high': return (extras[t.id]?.p || 0) === 3;
      case 'review': return t.status !== 'done' && hasLabel(t, 'claude done');
      case 'claude': return !!p && isAi(p.member);
      case 'mine': return !!p && !isAi(p.member);
      default: return true;
    }
  };
  const haystack = (t) => (t.id + ' ' + t.title + ' ' + (extras[t.id]?.l || []).join(' ') + ' ' + (extras[t.id]?.b || '')).toLowerCase();
  const visible = () => tickets.filter((t) => (!f.sprint || t.sprint.id === f.sprint) && (!f.who || plan.get(t.id)?.member === f.who) && viewOk(t) && (!f.q || haystack(t).includes(f.q)));
  const lanesFor = () => f.group === 'sprint' ? ov.sprints.map((sp, i) => ({ id: sp.id, label: sprintName(sp), chip: sprintLabel(sp), hue: hue(i) }))
    : f.group === 'who' ? [...team.map((m, i) => ({ id: m.id, label: m.name, chip: m.kind === 'ai' ? '✦' : '●', hue: hue(i) })), { id: '_', label: 'Unassigned', chip: '○', hue: 215 }]
    : [3, 2, 1, 0].map((n) => ({ id: String(n), label: n ? PRIORITY[n] + ' priority' : 'No priority', chip: n ? '⚑' : '·', hue: [215, 200, 40, 0][3 - n] }));
  const laneKey = (t) => f.group === 'sprint' ? t.sprint.id : f.group === 'who' ? plan.get(t.id)?.member || '_' : String(extras[t.id]?.p || 0);

  // ---------- cards (built lazily, reused across filters and moves)
  const cards = new Map();
  function buildCard(t) {
    const p = plan.get(t.id);
    const m = p && member(p.member);
    const ex = extras[t.id];
    const late = p && t.status !== 'done' && p.due < todayStr();
    const review = t.status !== 'done' && hasLabel(t, 'claude done');
    const ai = m?.kind === 'ai';
    return h('article', { class: 'bcard ' + t.status + (review ? ' review' : '') + (ai ? ' by-ai' : ''), draggable: 'true', dataset: { tid: t.id }, style: { '--h': t.hue } },
      h('div', { class: 'bc-top' }, h('span', { class: 'chip' }, shortId(t.id)), h('span', { class: 'bc-sp' }, sprintLabel(t.sprint)),
        ex?.p ? h('span', { class: 'bd prio-' + ex.p, title: PRIORITY[ex.p] + ' priority' }, '⚑') : null, h('span', { class: 'grow' }),
        multi && m ? h('button', { class: 'bc-who', dataset: { act: 'who' }, 'aria-label': `Owner: ${m.name}. Change`, title: `${m.name}${ai ? ' (AI assistant)' : ''}${p.manual.member ? ' (set by you)' : ' (auto)'}` }, ai ? h('span', { class: 'avatar ai sm', style: { '--mc': m.color } }, '✦') : avatar(m, 'sm')) : null,
        h('button', { class: 'mvb', dataset: { act: 'move' }, 'aria-label': `Move ${t.id} to another column`, title: 'Move to…' }, '⇄')),
      h('span', { class: 'bc-title', role: 'link', tabindex: 0, dataset: { act: 'open' }, title: 'Open task' }, t.title),
      review ? h('div', { class: 'bc-review' }, '✦ Claude finished this. Review it, then tick it off.') : null,
      t.status === 'blocked' && ex?.b ? h('div', { class: 'bc-block', title: 'Blocked reason' }, '⛔ ' + ex.b) : null,
      ex?.l?.length ? h('div', { class: 'bc-lbls' }, ex.l.slice(0, 3).map((l) => h('span', { class: labelClass(l) + ' on' }, l))) : null,
      h('div', { class: 'bc-prog' }, h('div', { class: 'bar thin' }, h('i', { style: { width: (t.total ? (t.done / t.total) * 100 : 0) + '%' } })), h('span', { class: 'muted small' }, `${t.done}/${t.total}`)),
      (p || t.notes || t.edits || ex?.st || ex?.fn) ? h('div', { class: 'bc-foot' },
        p ? h('span', { class: 'bc-due' + (late ? ' late' : ''), title: 'Planned due date' }, '🗓 ' + fmtDate(p.due)) : null,
        ex?.st ? h('span', { class: 'bd', title: `${ex.sd} of ${ex.st} subtasks done` }, `☑ ${ex.sd}/${ex.st}`) : null,
        ex?.fn ? h('span', { class: 'bd', title: `${ex.fn} file(s)` }, `📎 ${ex.fn}`) : null,
        t.notes ? h('span', { class: 'muted small', title: `${t.notes} note(s)` }, '✐ ' + t.notes) : null,
        t.edits ? h('span', { class: 'muted small', title: 'Edited slides' }, '✎ ' + t.edits) : null) : null);
  }
  const cardOf = (t) => { let el = cards.get(t.id); if (!el) { el = buildCard(t); cards.set(t.id, el); } return el; };
  const rebuildCard = (t) => { if (cards.has(t.id)) { const old = cards.get(t.id); const el = buildCard(t); old.replaceWith(el); cards.set(t.id, el); } };

  // ---------- layout and fill
  function buildLayout() {
    bodies = new Map();
    counters = new Map();
    const cols = COLS.filter((c) => !(f.hideDone && c.key === 'done'));
    const columns = (lane) => h('div', { class: 'bcols', style: { '--n': cols.length, gridTemplateColumns: cols.map((c) => (collapsed(c.key) ? '46px' : 'minmax(0, 1fr)')).join(' ') } }, cols.map((c) => {
      const key = (lane ?? '') + '|' + c.key;
      const count = h('button', { type: 'button', class: 'bcount', dataset: { wip: c.key }, title: 'Click to set a work-in-progress limit for this column' }, '0');
      counters.set(key, count);
      const body = h('div', { class: 'bcol-body', dataset: { col: c.key } });
      bodies.set(key, body);
      return h('section', { class: 'bcol ' + c.key + (collapsed(c.key) ? ' collapsed' : '') },
        h('header', { class: 'bcol-h' }, h('button', { type: 'button', class: 'bcol-fold', dataset: { fold: c.key }, title: collapsed(c.key) ? 'Expand column' : 'Collapse column', 'aria-label': (collapsed(c.key) ? 'Expand ' : 'Collapse ') + c.label }, h('i', { class: 'dot ' + c.key }), h('strong', {}, c.label)), count, lane ? null : h('span', { class: 'muted small ell' }, c.hint)), body);
    }));
    wrap.classList.toggle('compact', f.compact);
    if (!f.group) { stage.replaceChildren(columns()); return; }
    stage.replaceChildren(h('div', { class: 'blanes' }, lanesFor().map((ln) => {
      const open = ls('bdLane' + f.group + ln.id) !== '0';
      const head = h('button', { class: 'blane-h', 'aria-expanded': open, dataset: { lane: ln.id } }, h('span', { class: 'caret' }, '▸'), h('span', { class: 'chip' }, ln.chip), h('strong', { class: 'ell' }, ln.label), h('span', { class: 'muted small lane-count' }), h('div', { class: 'bar thin lane-bar' }, h('i', {})));
      return h('section', { class: 'blane' + (open ? '' : ' closed'), style: { '--h': ln.hue }, dataset: { sprint: ln.id } }, head, open ? columns(ln.id) : null);
    })));
  }

  function fill() {
    const items = visible();
    const per = new Map();
    for (const t of items) {
      const key = (f.group ? laneKey(t) : '') + '|' + t.status;
      (per.get(key) || per.set(key, []).get(key)).push(t);
    }
    for (const [key, body] of bodies) {
      const list = per.get(key) || [];
      const cap = caps.get(key) ?? (f.group ? 12 : CAP);
      const shown = list.slice(0, cap).map(cardOf);
      const kids = shown.length ? shown : [h('div', { class: 'bempty' }, 'Drop here')];
      if (list.length > cap) kids.push(h('button', { class: 'btn sm show-more', dataset: { more: key } }, `Show ${Math.min(CAP_STEP, list.length - cap)} more · ${list.length - cap} hidden`));
      body.replaceChildren(...kids);
      const ck = key.split('|')[1];
      const lim = wip(ck);
      const total = f.group ? items.filter((t) => t.status === ck).length : list.length;
      counters.get(key).textContent = lim ? `${list.length}/${lim}` : list.length;
      counters.get(key).classList.toggle('over', !!lim && total > lim);
      body.parentElement.classList.toggle('wip-over', !!lim && total > lim);
    }
    if (f.group) for (const lane of stage.querySelectorAll('.blane')) {
      const sp = lane.dataset.sprint;
      const mine = items.filter((t) => laneKey(t) === sp);
      lane.hidden = !mine.length;
      const done = mine.filter((t) => t.status === 'done').length;
      lane.querySelector('.lane-count').textContent = `${done}/${mine.length} done`;
      lane.querySelector('.lane-bar i').style.width = (mine.length ? (done / mine.length) * 100 : 0) + '%';
    }
    const counts = Object.fromEntries(COLS.map((c) => [c.key, items.filter((t) => t.status === c.key).length]));
    summary.replaceChildren(h('strong', {}, `${items.length} ticket${items.length === 1 ? '' : 's'}`), h('span', { class: 'muted' }, ` · ${items.length ? Math.round((counts.done / items.length) * 100) : 0}% done`),
      h('div', { class: 'bd-stack', title: 'Distribution by column' }, COLS.map((c) => h('i', { class: c.key, style: { flex: counts[c.key] || 0 }, title: `${c.label}: ${counts[c.key]}` }))));
  }
  const relayout = () => { buildLayout(); fill(); };

  // ---------- moving (updates the screen first, then the server; reverts on error)
  async function move(t, to) {
    if (t.status === to.key) return;
    const prev = { status: t.status, override: t.override, done: t.done };
    const back = restoreValue(t);
    t.status = to.key;
    if (to.key === 'done') t.done = t.total;
    rebuildCard(t);
    fill();
    try {
      const r = await api.ticketStatus(t.id, to.api);
      if (r.ticket) { Object.assign(t, { status: r.ticket.status, override: r.ticket.override, done: r.ticket.done, total: r.ticket.total }); patchTicket(r.ticket, r.player); }
      rebuildCard(t);
      fill();
      const el = cards.get(t.id);
      if (to.key === 'done') ticketComplete(t.title, el);
      else if (el && !reduceMotion()) el.classList.add('landed');
      if (to.key === 'blocked' && !extras[t.id]?.b) { const why = prompt(`Why is ${shortId(t.id)} blocked? (optional, shown on the card)`); if (why && why.trim()) { try { const cur = await api.ticketExtras(t.id); await api.saveExtras(t.id, { ...cur, b: why.trim(), ...(S.hosted ? {} : {}) }); extras = await api.extras(); rebuildCard(t); fill(); } catch (er) { toast(er.message, 'err'); } } }
      toast(`${shortId(t.id)} → ${to.label}${r.steps && to.key === 'done' ? ` · ${r.steps} step${r.steps === 1 ? '' : 's'} ticked` : ''}`, '', { label: 'Undo', fn: async () => {
        try { if (r.undo) await api.bulkUndo(r.undo); else await api.ticketStatus(t.id, back); toast('Undone'); await boardView(root); } catch (e) { toast(e.message, 'err'); }
      } });
    } catch (e) {
      Object.assign(t, prev);
      rebuildCard(t);
      fill();
      toast(e.message, 'err');
    }
  }

  async function assign(t, memberId) {
    try {
      const out = await api.planManual({ ticketId: t.id, member: memberId || null }, todayStr());
      sch = out.schedule;
      const before = new Map(plan);
      loadPlan(sch);
      for (const x of tickets) { const a = before.get(x.id), b = plan.get(x.id); if (a?.member !== b?.member || a?.due !== b?.due || a?.manual?.member !== b?.manual?.member) rebuildCard(x); }
      fill();
      toast(memberId ? 'Reassigned' : 'Back to auto split');
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---------- task drawer (assignee, dates, labels, subtasks, files, notes)
  const openTask = (id) => openDrawer(id, {
    onChange: async (what) => {
      if (what === 'extras' || what === 'note') { extras = await api.extras().catch(() => extras); const t = byId.get(id); if (t) { rebuildCard(t); fill(); } return; }
      await boardView(root);
    },
  });
  const strip = h('div', { class: 'bd-today' });
  const paintToday = () => {
    const d = todayStr();
    const due = tickets.filter((t) => t.status !== 'done' && plan.get(t.id) && !plan.get(t.id).history && plan.get(t.id).due <= d).sort((a, b) => plan.get(a.id).due.localeCompare(plan.get(b.id).due)).slice(0, 12);
    strip.hidden = !due.length;
    if (!due.length) return;
    const open = ls('bdToday') !== '0';
    strip.replaceChildren(h('button', { class: 'bd-today-h', type: 'button', 'aria-expanded': open, onClick: () => { ls('bdToday', open ? '0' : '1'); paintToday(); } }, h('span', { class: 'caret' }, open ? '▾' : '▸'), h('strong', {}, 'Today'), h('span', { class: 'muted small' }, `${due.length} due today or overdue`)),
      open ? h('div', { class: 'bd-today-l' }, due.map((t) => { const p = plan.get(t.id); const m = member(p.member); return h('button', { type: 'button', class: 'bt-chip' + (p.due < d ? ' late' : ''), onClick: () => openTask(t.id), title: t.title }, h('i', { class: 'dot ' + t.status }), shortId(t.id), h('span', { class: 'ell' }, t.title), multi && m ? (m.kind === 'ai' ? h('span', { class: 'avatar ai xs', style: { '--mc': m.color } }, '✦') : avatar(m, 'xs')) : null); })) : null);
  };

  // ---------- one set of delegated listeners for the whole board
  const cardEl = (e) => e.target.closest?.('.bcard');
  wrap.addEventListener('dragstart', (e) => {
    const c = cardEl(e);
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.tid);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
    document.body.classList.add('bd-dragging');
  });
  wrap.addEventListener('dragend', () => {
    document.body.classList.remove('bd-dragging');
    wrap.querySelectorAll('.dragging, .over').forEach((x) => x.classList.remove('dragging', 'over'));
  });
  wrap.addEventListener('dragover', (e) => {
    const body = e.target.closest?.('.bcol-body');
    if (!body) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    body.parentElement.classList.add('over');
  });
  wrap.addEventListener('dragleave', (e) => {
    const col = e.target.closest?.('.bcol');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
  });
  wrap.addEventListener('drop', (e) => {
    const body = e.target.closest?.('.bcol-body');
    if (!body) return;
    e.preventDefault();
    body.parentElement.classList.remove('over');
    const t = byId.get(e.dataTransfer.getData('text/plain'));
    if (t) move(t, byKey[body.dataset.col]);
  });
  wrap.addEventListener('click', (e) => {
    const more = e.target.closest?.('[data-more]');
    if (more) { const k = more.dataset.more; caps.set(k, (caps.get(k) ?? (f.group ? 12 : CAP)) + CAP_STEP); fill(); return; }
    const lane = e.target.closest?.('.blane-h');
    const wipBtn = e.target.closest?.('[data-wip]');
    if (wipBtn) { const k = wipBtn.dataset.wip; const v = prompt(`Work-in-progress limit for "${byKey[k].label}" (0 = no limit). Cards over the limit turn the column red.`, String(wip(k))); if (v !== null) { ls('bdWip.' + k, String(Math.max(0, parseInt(v, 10) || 0))); fill(); } return; }
    const fold = e.target.closest?.('[data-fold]');
    if (fold) { const k = fold.dataset.fold; ls('bdCol.' + k, collapsed(k) ? '0' : '1'); relayout(); return; }
    if (lane) { const id = lane.dataset.lane; ls('bdLane' + f.group + id, ls('bdLane' + f.group + id) === '0' ? '1' : '0'); relayout(); return; }
    const act = e.target.closest?.('[data-act]');
    const c = cardEl(e);
    if (!c) return;
    const t = byId.get(c.dataset.tid);
    if (!act) { if (!e.target.closest('button, a, input, select')) openTask(t.id); return; }
    if (act.dataset.act === 'open') openTask(t.id);
    else if (act.dataset.act === 'move') openMenu(act, `Move ${shortId(t.id)} to`, COLS.map((x) => ({ value: x.key, label: x.label, dot: x.key, active: x.key === t.status })), (k) => move(t, byKey[k]));
    else if (act.dataset.act === 'who') {
      const cur = plan.get(t.id);
      openMenu(act, 'Owner', [...team.map((m) => ({ value: m.id, label: m.name, active: m.id === cur?.member })), ...(cur?.manual.member ? [{ value: '', label: '↺ Auto split' }] : [])], (v) => assign(t, v));
    }
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.act === 'open') e.target.click(); });

  // ---------- toolbar
  const sprintSel = h('select', { class: 'sel', 'aria-label': 'Filter by sprint', onChange: (e) => { f.sprint = e.target.value; ls('bdSprint', f.sprint); fill(); } }, h('option', { value: '' }, 'All sprints'), ov.sprints.map((sp) => h('option', { value: sp.id, selected: sp.id === f.sprint }, `${sprintLabel(sp)} · ${sprintName(sp)}`)));
  const whoSel = multi ? h('select', { class: 'sel', 'aria-label': 'Filter by person', onChange: (e) => { f.who = e.target.value; ls('bdWho', f.who); fill(); } }, h('option', { value: '' }, 'Everyone'), team.map((m) => h('option', { value: m.id, selected: m.id === f.who }, m.name))) : null;
  const search = h('input', { class: 'bd-search', type: 'search', placeholder: 'Filter tickets…', 'aria-label': 'Filter tickets', value: f.q, onInput: debounce((e) => { f.q = e.target.value.trim().toLowerCase(); fill(); }, 120) });
  const viewSel = h('select', { class: 'sel', 'aria-label': 'Saved view', onChange: (e) => { f.view = e.target.value; ls('bdView', f.view); fill(); } }, Object.entries(VIEWS).map(([k, l]) => h('option', { value: k, selected: k === f.view }, l)));
  // my saved filters (stored with the account): snapshot of the current toolbar, applied by re-rendering the board
  const snap = () => ({ sprint: f.sprint || '', who: f.who || '', q: f.q || '', view: f.view || '', group: f.group || '', hideDone: f.hideDone ? 1 : 0 });
  const applyView = (v) => { ls('bdSprint', v.f.sprint); ls('bdWho', v.f.who); ls('bdView', v.f.view); ls('bdGroup', v.f.group); ls('bdHideDone', v.f.hideDone ? '1' : '0'); ls('bdQ', v.f.q); boardView(root); };
  const mineSel = h('select', { class: 'sel', 'aria-label': 'My saved filters', onChange: (e) => { const v = myViews.find((x) => x.id === e.target.value); if (v) applyView(v); } },
    h('option', { value: '' }, myViews.length ? 'My filters…' : 'My filters (none yet)'), myViews.map((v) => h('option', { value: v.id, selected: JSON.stringify(v.f) === JSON.stringify(snap()) }, v.name)));
  const saveMine = async () => {
    const name = (prompt('Name this filter (it saves the sprint, person, view, search, grouping and Hide Done):') || '').trim().slice(0, 40);
    if (!name) return;
    try { const same = myViews.find((x) => x.name.toLowerCase() === name.toLowerCase()); myViews = await api.saveViews([...myViews.filter((x) => x !== same), { id: same?.id, name, f: snap() }]); toast(`Saved “${name}”.`); boardView(root); } catch (e) { toast(e.message, 'err'); }
  };
  const delMine = async () => {
    const v = myViews.find((x) => x.id === mineSel.value); if (!v) return toast('Pick one of your filters first.');
    if (!confirm(`Delete the filter “${v.name}”?`)) return;
    try { myViews = await api.saveViews(myViews.filter((x) => x !== v)); toast('Deleted.'); boardView(root); } catch (e) { toast(e.message, 'err'); }
  };
  const groupSel = h('select', { class: 'sel', 'aria-label': 'Group cards', onChange: (e) => { f.group = e.target.value; ls('bdGroup', f.group); relayout(); } }, Object.entries(GROUPS).map(([k, l]) => h('option', { value: k, selected: k === f.group }, l)));
  const tog = (label, key, storeKey) => h('label', { class: 'tgl' }, h('input', { type: 'checkbox', checked: f[key], onChange: (e) => { f[key] = e.target.checked; ls(storeKey, f[key] ? '1' : '0'); relayout(); } }), label);

  wrap.append(summary, stage);
  root.replaceChildren(h('div', { class: 'dash board' },
    h('div', { class: 'sec-head' }, h('h1', { class: 'page-title' }, 'Board'), h('div', { class: 'row gap' }, h('a', { class: 'btn', href: '#/timeline' }, planData.plan ? '🗓 Timeline' : 'Plan a timeline & team'))),
    h('div', { class: 'bd-filters' }, sprintSel, whoSel, viewSel, mineSel, h('button', { class: 'btn sm', type: 'button', title: 'Save the current filters under a name', onClick: saveMine }, '💾 Save filters'), h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Delete selected saved filter', title: 'Delete the selected saved filter', onClick: delMine }, '🗑'), search, groupSel, tog('Hide Done', 'hideDone', 'bdHideDone'), tog('Compact', 'compact', 'bdCompact')),
    strip,
    wrap,
    h('p', { class: 'muted small' }, 'Click a card to open its drawer. Drag it to a column, or use ⇄. Done ticks every step (Undo is offered); finishing the last step moves a ticket to Done by itself. Pending keeps the steps you already ticked. Click a column count to set a work-in-progress limit, or a column title to fold it.')));
  paintToday();
  relayout();
  enter(root);
}
