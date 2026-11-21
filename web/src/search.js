import { h, esc, debounce } from './dom.js';
import { openModal } from './modal.js';
import { api } from './api.js';

const snippet = (r) => {
  const inNote = !(r.body_snip || '').includes('\x01') && (r.note_snip || '').includes('\x01');
  const text = inNote ? r.note_snip : r.body_snip || r.note_snip;
  return h('div', { class: 'sr-snip' }, inNote ? h('span', { class: 'chip edit' }, 'note') : null, h('span', { html: hl(text) }));
};
const hl = (s) => esc(s || '').replace(/\x01/g, '<mark>').replace(/\x02/g, '</mark>');

export function openSearch() {
  const input = h('input', { class: 'sr-input', placeholder: 'Search every ticket, step, note…', 'aria-label': 'Search', spellcheck: false });
  const list = h('div', { class: 'sr-list', role: 'listbox' });
  let results = [];
  let sel = 0;
  let m;

  const go = (r) => {
    m.close(true);
    location.hash = `#/t/${encodeURIComponent(r.ticket_id)}/${r.id}`;
  };
  const paint = () => {
    list.replaceChildren(
      ...results.map((r, i) =>
        h('a', { class: 'sr-item' + (i === sel ? ' on' : ''), role: 'option', href: `#/t/${encodeURIComponent(r.ticket_id)}/${r.id}`, onClick: (e) => { e.preventDefault(); go(r); }, onMouseenter: () => { sel = i; mark(); } },
          h('div', { class: 'sr-top' }, h('span', { class: 'chip' }, r.ticket_id.replace(/-ref-/, ' ref ')), h('span', { class: 'sr-title', html: hl(r.title_snip || r.step_title) }), r.kind === 'intro' ? null : null),
          h('div', { class: 'sr-ticket muted small' }, r.ticket_title),
          snippet(r))),
    );
    if (!results.length && input.value.trim()) list.append(h('p', { class: 'muted pad' }, 'No matches.'));
    if (!input.value.trim()) list.append(h('p', { class: 'muted pad' }, 'Type to search. ↑ ↓ to move, Enter to open.'));
  };
  const mark = () => [...list.querySelectorAll('.sr-item')].forEach((el, i) => el.classList.toggle('on', i === sel));
  let token = 0;
  const run = debounce(async () => {
    const my = ++token;
    const q = input.value.trim();
    if (!q) { results = []; sel = 0; return paint(); }
    try {
      const r = await api.search(q);
      if (my !== token) return;
      results = r.results;
      sel = 0;
      paint();
    } catch {}
  }, 110);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); mark(); list.querySelectorAll('.sr-item')[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); list.querySelectorAll('.sr-item')[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); go(results[sel]); }
  });
  m = openModal(h('div', { class: 'search' }, input, list), { top: true, label: 'Search' });
  paint();
  input.focus();
}
