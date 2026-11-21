import { h, bar, pct } from './dom.js';
import { S, sprintLabel, sprintName, shortId, STATUS_LABEL } from './state.js';
import { refreshOverview } from './sidebar.js';
import { runBulk } from './bulkui.js';
import { enter } from './motion.js';

const open = new Set();

export async function manageView(root) {
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Manage progress — Tutorial Tracker';
  const ov = await refreshOverview();
  const tickets = new Map();
  for (const sp of ov.sprints) for (const t of sp.items) if (t.kind === 'ticket' && !t.deferred) tickets.set(t.id, t);
  const sel = new Set();

  const again = () => manageView(root);

  const summary = h('div', { class: 'mg-sum' });
  const bDone = h('button', { class: 'btn primary', onClick: () => runBulk('done', { ticketIds: [...sel] }, `${sel.size} selected ticket${sel.size === 1 ? '' : 's'}`, again) }, '✓ Mark done');
  const bReset = h('button', { class: 'btn', onClick: () => runBulk('reset', { ticketIds: [...sel] }, `${sel.size} selected ticket${sel.size === 1 ? '' : 's'}`, again) }, '↺ Reset');
  const bClear = h('button', { class: 'link', onClick: () => { sel.clear(); paint(); } }, 'Clear selection');

  const rows = new Map(); // ticket id -> checkbox
  const sprintBoxes = new Map();

  function paint() {
    let toTick = 0;
    let toClear = 0;
    for (const id of sel) {
      const t = tickets.get(id);
      toTick += t.total - t.done;
      toClear += t.done;
    }
    summary.replaceChildren(sel.size ? h('span', {}, h('strong', {}, sel.size), ` ticket${sel.size === 1 ? '' : 's'} selected · `, h('span', { class: 'muted' }, `${toTick} step${toTick === 1 ? '' : 's'} to tick, ${toClear} to clear`)) : h('span', { class: 'muted' }, 'Select tickets or sprints below, or use the quick actions.'));
    bDone.disabled = bReset.disabled = !sel.size;
    bClear.hidden = !sel.size;
    for (const [id, box] of rows) box.checked = sel.has(id);
    for (const [sid, { box, ids }] of sprintBoxes) {
      const n = ids.filter((i) => sel.has(i)).length;
      box.checked = n > 0 && n === ids.length;
      box.indeterminate = n > 0 && n < ids.length;
    }
  }

  const blocks = ov.sprints.map((sp, si) => {
    const list = sp.items.filter((t) => t.kind === 'ticket');
    const ids = list.filter((t) => !t.deferred).map((t) => t.id);
    const box = h('input', { type: 'checkbox', 'aria-label': `Select all of ${sprintLabel(sp)}`, onChange: (e) => { for (const i of ids) e.target.checked ? sel.add(i) : sel.delete(i); paint(); } });
    sprintBoxes.set(sp.id, { box, ids });
    const body = h('div', { class: 'mg-tickets', hidden: !open.has(sp.id) });
    // Rows are built the first time the sprint is opened (closed sprints cost nothing).
    const build = () => {
      if (body.dataset.built) return;
      body.dataset.built = '1';
      body.replaceChildren(...list.map((t) => {
        const cb = h('input', { type: 'checkbox', disabled: !!t.deferred, 'aria-label': `Select ${t.id}`, checked: sel.has(t.id), onChange: (e) => { e.target.checked ? sel.add(t.id) : sel.delete(t.id); paint(); } });
        if (!t.deferred) rows.set(t.id, cb);
        return h('label', { class: 'mg-row' + (t.deferred ? ' deferred' : '') }, cb, h('i', { class: 'dot ' + t.status }), h('span', { class: 'tid' }, shortId(t.id)), h('span', { class: 'grow ell' }, t.title),
          h('span', { class: 'muted small' }, t.deferred ? 'deferred' : `${t.done}/${t.total}`), h('span', { class: 'st-mini ' + t.status }, STATUS_LABEL[t.status]));
      }));
    };
    if (open.has(sp.id)) build();
    const toggle = h('button', { class: 'mg-toggle', 'aria-expanded': open.has(sp.id), title: 'Show tickets', onClick: () => { if (body.hidden) build(); body.hidden = !body.hidden; body.hidden ? open.delete(sp.id) : open.add(sp.id); toggle.setAttribute('aria-expanded', !body.hidden); toggle.classList.toggle('open', !body.hidden); } }, '▸');
    toggle.classList.toggle('open', open.has(sp.id));
    return h('section', { class: 'mg-sprint' + (sp.complete ? ' complete' : ''), style: { '--i': si } },
      h('div', { class: 'mg-head' }, toggle, box,
        h('div', { class: 'grow' }, h('strong', {}, sprintLabel(sp), ' · ', sprintName(sp)), h('div', { class: 'row' }, h('div', { class: 'grow-bar' }, bar(sp.done, sp.total, 'thin')), h('span', { class: 'muted small' }, `${pct(sp.done, sp.total)}% · ${sp.ticketsDone}/${sp.ticketsTotal} tickets`))),
        h('button', { class: 'btn sm', disabled: sp.complete, onClick: () => runBulk('done', { sprintIds: [sp.id] }, sprintLabel(sp), again) }, 'Mark done'),
        h('button', { class: 'btn sm', disabled: !sp.done, onClick: () => runBulk('reset', { sprintIds: [sp.id] }, sprintLabel(sp), again) }, 'Reset')),
      body);
  });

  root.replaceChildren(h('div', { class: 'dash' },
    h('h1', { class: 'page-title' }, 'Manage progress'),
    h('p', { class: 'muted' }, 'Change many tickets at once. “Done” ticks every step inside, so the dashboard, bars and achievements always agree.'),
    h('div', { class: 'mg-quick' },
      h('button', { class: 'btn', onClick: () => runBulk('done', { all: true }, 'Every sprint', again) }, '✓ Mark everything done'),
      h('button', { class: 'btn', onClick: () => runBulk('reset', { all: true }, 'Every sprint', again) }, '↺ Reset everything'),
      h('button', { class: 'link', onClick: () => { for (const sp of ov.sprints) open.add(sp.id); again(); } }, 'Expand all')),
    h('div', { class: 'mg-bar' }, summary, h('span', { class: 'grow' }), bClear, bReset, bDone),
    h('div', { class: 'mg-list' }, blocks)));
  paint();
  enter(root);
}
