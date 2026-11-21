import { h, toast, debounce } from './dom.js';
import { api } from './api.js';
import { S, ls, sprintLabel, sprintName, shortId } from './state.js';
import { refreshOverview, patchTicket } from './sidebar.js';
import { ticketComplete } from './fx.js';
import { todayStr, fmtDate } from './dates.js';
import { avatar } from './ui.js';
import { enter, reduceMotion } from './motion.js';

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
  const [ov, planData] = await Promise.all([refreshOverview(), api.plan(todayStr()).catch(() => ({ plan: null }))]);
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

  const f = { sprint: ls('bdSprint') || '', who: ls('bdWho') || '', q: '', lanes: ls('bdLanes') === '1', hideDone: ls('bdHideDone') === '1' };
  if (f.sprint && !ov.sprints.some((s) => s.id === f.sprint)) f.sprint = '';
  if (f.who && !member(f.who)) f.who = '';

  const wrap = h('div', { class: 'board-wrap' });
  const summary = h('div', { class: 'bd-sum' });
  const stage = h('div', {});
  const caps = new Map(); // body key -> cards shown
  let bodies = new Map(); // body key -> element
  let counters = new Map(); // column key (+lane) -> count element

  const visible = () => tickets.filter((t) => (!f.sprint || t.sprint.id === f.sprint) && (!f.who || plan.get(t.id)?.member === f.who) && (!f.q || (t.id + ' ' + t.title).toLowerCase().includes(f.q)));

  // ---------- cards (built lazily, reused across filters and moves)
  const cards = new Map();
  function buildCard(t) {
    const p = plan.get(t.id);
    const m = p && member(p.member);
    const late = p && t.status !== 'done' && p.due < todayStr();
    return h('article', { class: 'bcard ' + t.status, draggable: 'true', dataset: { tid: t.id }, style: { '--h': t.hue } },
      h('div', { class: 'bc-top' }, h('span', { class: 'chip' }, shortId(t.id)), h('span', { class: 'bc-sp' }, sprintLabel(t.sprint)), h('span', { class: 'grow' }),
        multi && m ? h('button', { class: 'bc-who', dataset: { act: 'who' }, 'aria-label': `Owner: ${m.name}. Change`, title: `${m.name}${p.manual.member ? ' (set by you)' : ' (auto)'}` }, avatar(m, 'sm')) : null,
        h('button', { class: 'mvb', dataset: { act: 'move' }, 'aria-label': `Move ${t.id} to another column`, title: 'Move to…' }, '⇄')),
      h('span', { class: 'bc-title', role: 'link', tabindex: 0, dataset: { act: 'open' }, title: 'Open ticket' }, t.title),
      h('div', { class: 'bc-prog' }, h('div', { class: 'bar thin' }, h('i', { style: { width: (t.total ? (t.done / t.total) * 100 : 0) + '%' } })), h('span', { class: 'muted small' }, `${t.done}/${t.total}`)),
      (p || t.notes || t.edits) ? h('div', { class: 'bc-foot' },
        p ? h('span', { class: 'bc-due' + (late ? ' late' : ''), title: 'Planned due date' }, '🗓 ' + fmtDate(p.due)) : null,
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
    const columns = (lane) => h('div', { class: 'bcols', style: { '--n': cols.length } }, cols.map((c) => {
      const key = (lane ?? '') + '|' + c.key;
      const count = h('span', { class: 'bcount' }, '0');
      counters.set(key, count);
      const body = h('div', { class: 'bcol-body', dataset: { col: c.key } });
      bodies.set(key, body);
      return h('section', { class: 'bcol ' + c.key }, h('header', { class: 'bcol-h' }, h('i', { class: 'dot ' + c.key }), h('strong', {}, c.label), count, lane ? null : h('span', { class: 'muted small ell' }, c.hint)), body);
    }));
    if (!f.lanes) { stage.replaceChildren(columns()); return; }
    stage.replaceChildren(h('div', { class: 'blanes' }, ov.sprints.map((sp, i) => {
      const open = ls('bdLane' + sp.id) !== '0';
      const head = h('button', { class: 'blane-h', 'aria-expanded': open, dataset: { lane: sp.id } }, h('span', { class: 'caret' }, '▸'), h('span', { class: 'chip' }, sprintLabel(sp)), h('strong', { class: 'ell' }, sprintName(sp)), h('span', { class: 'muted small lane-count' }), h('div', { class: 'bar thin lane-bar' }, h('i', {})));
      return h('section', { class: 'blane' + (open ? '' : ' closed'), style: { '--h': hue(i) }, dataset: { sprint: sp.id } }, head, open ? columns(sp.id) : null);
    })));
  }

  function fill() {
    const items = visible();
    const per = new Map();
    for (const t of items) {
      const key = (f.lanes ? t.sprint.id : '') + '|' + t.status;
      (per.get(key) || per.set(key, []).get(key)).push(t);
    }
    for (const [key, body] of bodies) {
      const list = per.get(key) || [];
      const cap = caps.get(key) ?? (f.lanes ? 12 : CAP);
      const shown = list.slice(0, cap).map(cardOf);
      const kids = shown.length ? shown : [h('div', { class: 'bempty' }, 'Drop here')];
      if (list.length > cap) kids.push(h('button', { class: 'btn sm show-more', dataset: { more: key } }, `Show ${Math.min(CAP_STEP, list.length - cap)} more · ${list.length - cap} hidden`));
      body.replaceChildren(...kids);
      counters.get(key).textContent = list.length;
    }
    if (f.lanes) for (const lane of stage.querySelectorAll('.blane')) {
      const sp = lane.dataset.sprint;
      const mine = items.filter((t) => t.sprint.id === sp);
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
    if (more) { const k = more.dataset.more; caps.set(k, (caps.get(k) ?? (f.lanes ? 12 : CAP)) + CAP_STEP); fill(); return; }
    const lane = e.target.closest?.('.blane-h');
    if (lane) { const id = lane.dataset.lane; ls('bdLane' + id, ls('bdLane' + id) === '0' ? '1' : '0'); relayout(); return; }
    const act = e.target.closest?.('[data-act]');
    const c = cardEl(e);
    if (!act || !c) return;
    const t = byId.get(c.dataset.tid);
    if (act.dataset.act === 'open') location.hash = `#/t/${encodeURIComponent(t.id)}`;
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
  const search = h('input', { class: 'bd-search', type: 'search', placeholder: 'Filter tickets…', 'aria-label': 'Filter tickets', onInput: debounce((e) => { f.q = e.target.value.trim().toLowerCase(); fill(); }, 120) });
  const tog = (label, key, storeKey) => h('label', { class: 'tgl' }, h('input', { type: 'checkbox', checked: f[key], onChange: (e) => { f[key] = e.target.checked; ls(storeKey, f[key] ? '1' : '0'); relayout(); } }), label);

  wrap.append(summary, stage);
  root.replaceChildren(h('div', { class: 'dash board' },
    h('div', { class: 'sec-head' }, h('h1', { class: 'page-title' }, 'Board'), h('div', { class: 'row gap' }, h('a', { class: 'btn', href: '#/timeline' }, planData.plan ? '🗓 Timeline' : 'Plan a timeline & team'))),
    h('div', { class: 'bd-filters' }, sprintSel, whoSel, search, tog('Group by sprint', 'lanes', 'bdLanes'), tog('Hide Done', 'hideDone', 'bdHideDone')),
    wrap,
    h('p', { class: 'muted small' }, 'Drag a card to a column, or use the ⇄ button on the card. Done ticks every step (Undo is offered); finishing the last step of a ticket moves it to Done by itself. Pending keeps the steps you already ticked.')));
  relayout();
  enter(root);
}
