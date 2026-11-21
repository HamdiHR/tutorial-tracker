// First login (and Settings > Starting point): where are you in the tutorial?
import { h } from './dom.js';
import { api } from './api.js';
import { S, sprintName } from './state.js';
import { plural } from './dates.js';

/** Returns a promise that resolves once the choice is saved. `redo` = changing an earlier choice. */
export function runOnboarding({ redo = false, cancelable = false } = {}) {
  return new Promise((resolve, reject) => {
    document.body.classList.add('auth-open');
    const card = h('div', { class: 'auth-card wide' });
    const root = h('div', { class: 'auth' }, card);
    document.body.append(root);
    const close = () => { root.remove(); document.body.classList.remove('auth-open'); };
    const cancel = cancelable ? h('button', { class: 'link', onClick: () => { close(); reject(new Error('cancelled')); } }, 'Cancel') : null;
    const err = h('div', { class: 'auth-msg err', role: 'alert' });
    let busy = false;

    async function save(body) {
      if (busy) return;
      busy = true; err.textContent = '';
      try { await api.onboard({ ...body, redo }); close(); resolve(); }
      catch (e) { err.textContent = e.message; busy = false; }
    }

    const choose = () => card.replaceChildren(
      h('h1', {}, redo ? 'Change your starting point' : 'Where are you in the tutorial?'),
      h('p', { class: 'muted' }, redo ? 'This resets your ticked steps (notes and edits stay), then applies your new choice.' : 'This sets up your progress. You can change it later in Settings.'),
      h('div', { class: 'ob-choices' },
        h('button', { class: 'ob-choice', onClick: () => save({ mode: 'zero' }) }, h('strong', {}, 'Start from the beginning'), h('span', { class: 'muted' }, 'Nothing is ticked. Sprint 0, ticket 1.')),
        h('button', { class: 'ob-choice', onClick: pick }, h('strong', {}, 'I am already part-way through'), h('span', { class: 'muted' }, 'Pick the ticket you are on now.'))),
      err, cancel);

    async function pick() {
      let ov = S.overview;
      try { ov = await api.overview(); } catch (e) { err.textContent = e.message; return; }
      const sprints = ov.sprints.filter((s) => s.items.some((i) => i.kind === 'ticket' && !i.deferred));
      const sel = h('select', { class: 'sel', 'aria-label': 'Sprint' }, sprints.map((s) => h('option', { value: s.id }, `S${s.id} — ${sprintName(s)}`)));
      const tsel = h('select', { class: 'sel', 'aria-label': 'Ticket' });
      const fill = () => {
        const sp = sprints.find((s) => s.id === sel.value);
        tsel.replaceChildren(...sp.items.filter((i) => i.kind === 'ticket' && !i.deferred).map((i) => h('option', { value: i.id }, `${i.id} — ${i.title} (${plural(i.total, 'step')})`)));
      };
      sel.addEventListener('change', fill); fill();
      card.replaceChildren(
        h('h1', {}, 'Which ticket are you on?'),
        h('p', { class: 'muted' }, 'Choose the ticket you are about to work on (or are in the middle of).'),
        h('label', { class: 'auth-field' }, h('span', {}, 'Sprint'), sel),
        h('label', { class: 'auth-field' }, h('span', {}, 'Ticket'), tsel),
        h('div', { class: 'row gap' }, h('button', { class: 'btn', onClick: choose }, '← Back'), h('button', { class: 'btn primary', onClick: () => confirm(ov, tsel.value) }, 'Next')), err);
    }

    function confirm(ov, ticketId) {
      const real = ov.sprints.flatMap((s) => s.items).filter((i) => i.kind === 'ticket' && !i.deferred);
      const at = real.findIndex((i) => i.id === ticketId);
      const before = real.slice(0, at);
      const steps = before.reduce((n, i) => n + i.total, 0);
      const t = real[at];
      card.replaceChildren(
        h('h1', {}, 'Mark the earlier work as done?'),
        h('p', {}, 'You start at ', h('strong', {}, `${t.id} — ${t.title}`), '.'),
        at === 0
          ? h('p', { class: 'muted' }, 'This is the very first ticket, so there is nothing before it.')
          : h('p', { class: 'muted' }, `Before it there ${before.length === 1 ? 'is' : 'are'} ${plural(before.length, 'ticket')} with ${plural(steps, 'step')}. Mark them all as done so your progress and timeline start from here?`),
        h('div', { class: 'ob-choices' },
          at > 0 ? h('button', { class: 'ob-choice', onClick: () => save({ mode: 'point', ticketId, markPrevious: true }) }, h('strong', {}, `Yes, mark ${plural(steps, 'step')} as done`), h('span', { class: 'muted' }, 'Everything before this ticket counts as finished.')) : null,
          h('button', { class: 'ob-choice', onClick: () => save({ mode: 'point', ticketId, markPrevious: false }) }, h('strong', {}, at > 0 ? 'No, leave them unticked' : 'Start here'), h('span', { class: 'muted' }, at > 0 ? 'I will tick the earlier ones myself.' : 'Nothing to mark.'))),
        h('div', { class: 'row gap' }, h('button', { class: 'btn', onClick: pick }, '← Back')), err);
    }
    choose();
  });
}
