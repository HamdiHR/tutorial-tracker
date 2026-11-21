import { h, toast, debounce } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { renderInline, ensureMd } from './md.js';
import { refreshOverview, renderSidebar } from './sidebar.js';

const STATES = [['open', 'Open'], ['checked', 'Checked'], ['fixed', 'Fixed'], ['wrong', 'Still wrong'], ['all', 'All']];

export async function driftView(root, state = 'open') {
  await ensureMd();
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Drift inbox — Tutorial Tracker';
  let data;
  try { data = await api.drift(state); } catch (e) { return root.replaceChildren(h('p', { class: 'pad' }, e.message)); }

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const tabs = h('div', { class: 'tabs' }, STATES.map(([k, label]) =>
    h('button', { class: 'tab' + (k === state ? ' on' : ''), onClick: () => driftView(root, k) }, label, h('span', { class: 'muted' }, ' ' + (k === 'all' ? total : data.counts[k] || 0)))));

  const sprintOf = (tid) => (/^S(\d+(?:\.\d+)?)-/.exec(tid) || [])[1] ?? '?';
  const groups = new Map();
  for (const it of data.items) (groups.get(sprintOf(it.ticket_id)) || groups.set(sprintOf(it.ticket_id), []).get(sprintOf(it.ticket_id))).push(it);
  const countEls = new Map();
  const tabsEl = tabs;
  const retab = () => {
    const tot = Object.values(data.counts).reduce((x, y) => x + y, 0);
    tabsEl.querySelectorAll('.tab').forEach((b, i) => { const k = STATES[i][0]; b.lastChild.textContent = ' ' + (k === 'all' ? tot : data.counts[k] || 0); });
  };

  // Changing one item updates the screen in place (no reload of the whole list).
  const set = async (it, st, el) => {
    try {
      await api.driftUpdate(it.id, { state: st });
      data.counts[it.state] = Math.max(0, (data.counts[it.state] || 0) - 1);
      data.counts[st] = (data.counts[st] || 0) + 1;
      it.state = st;
      if (state === 'all') el.replaceWith(row(it));
      else el.remove();
      const g = groups.get(sprintOf(it.ticket_id));
      const n = g.filter((x) => state === 'all' || x.state === state).length;
      countEls.get(sprintOf(it.ticket_id)).textContent = n;
      retab();
      if (S.overview) { S.overview.driftOpen = data.counts.open || 0; renderSidebar(); }
    } catch (e) { toast(e.message, 'err'); }
  };

  function row(it) {
    const note = h('input', { class: 'dr-note', placeholder: 'Note (optional)', value: it.note, 'aria-label': 'Note' });
    const save = debounce(() => api.driftUpdate(it.id, { note: note.value }).catch((e) => toast(e.message, 'err')), 500);
    note.addEventListener('input', save);
    const el = h('div', { class: 'dr-item ' + it.state },
      h('div', { class: 'dr-top' },
        h('a', { class: 'chip', href: `#/t/${encodeURIComponent(it.ticket_id)}/${it.step_id}` }, it.ticket_id),
        h('span', { class: 'muted ell' }, it.step_title.replace(/^\d+(\.\d+)*\.?\s*/, '')),
        h('span', { class: 'grow' }),
        h('a', { class: 'link', href: `#/t/${encodeURIComponent(it.ticket_id)}/${it.step_id}` }, 'Open slide →')),
      h('div', { class: 'dr-line', html: renderInline(it.line) }),
      h('div', { class: 'dr-act' },
        note,
        it.state === 'open'
          ? [h('button', { class: 'btn sm', onClick: () => set(it, 'checked', el) }, '✓ Checked, still valid'), h('button', { class: 'btn sm', onClick: () => set(it, 'fixed', el) }, '🔧 Fixed'), h('button', { class: 'btn sm', onClick: () => set(it, 'wrong', el) }, '✗ Still wrong')]
          : h('button', { class: 'btn sm', onClick: () => set(it, 'open', el) }, 'Reopen')));
    return el;
  }

  // One collapsible group per sprint; a group's rows are only built when it is opened.
  const sections = [...groups].map(([k, items], i) => {
    const body = h('div', { class: 'dr-list' });
    const count = h('span', { class: 'muted' }, items.length);
    countEls.set(k, count);
    const build = () => { if (!body.dataset.built) { body.dataset.built = '1'; body.replaceChildren(...items.map(row)); } };
    const d = h('details', { class: 'dr-group', open: i === 0 }, h('summary', {}, h('strong', {}, k === '?' ? 'Other' : `Sprint ${k}`), count), body);
    d.addEventListener('toggle', () => d.open && build());
    if (i === 0) build();
    return d;
  });

  root.replaceChildren(h('div', { class: 'dash' },
    h('h1', { class: 'page-title' }, 'Drift inbox'),
    h('p', { class: 'muted' }, 'Every spot the tutorial marks “🔍 Verify against docs”. Library APIs move fast — mark each one as you confirm it.'),
    tabs,
    sections.length ? h('div', { class: 'dr-groups' }, sections) : h('p', { class: 'empty-note' }, state === 'open' ? 'Nothing left to verify. 🎉' : 'Nothing here.')));
}
