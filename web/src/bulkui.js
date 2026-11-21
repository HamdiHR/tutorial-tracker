import { h, toast } from './dom.js';
import { api } from './api.js';
import { openModal } from './modal.js';
import { refreshOverview } from './sidebar.js';

/**
 * Ask, apply, and offer Undo.
 * action: 'done' | 'reset'; targets: {all} | {sprintIds} | {ticketIds}; label: "Sprint 3", "12 selected tickets"…
 */
export async function runBulk(action, targets, label, after) {
  let dry;
  try {
    dry = await api.bulk(action, targets, true);
  } catch (e) {
    return toast(e.message, 'err');
  }
  if (!dry.tickets) return toast('Nothing to change');
  if (!dry.steps) return toast(action === 'done' ? 'Everything there is already done' : 'Nothing to reset');

  const done = action === 'done';
  await new Promise((resolve) => {
    let m;
    const go = async () => {
      m.close(true);
      try {
        const r = await api.bulk(action, targets);
        await refreshOverview();
        after?.();
        toast(`${r.steps} step${r.steps === 1 ? '' : 's'} ${done ? 'ticked' : 'cleared'} in ${r.tickets} ticket${r.tickets === 1 ? '' : 's'}`, '', {
          label: 'Undo',
          fn: async () => {
            try {
              await api.bulkUndo(r.undo);
              await refreshOverview();
              after?.();
              toast('Undone');
            } catch (e) {
              toast(e.message, 'err');
            }
          },
        });
      } catch (e) {
        toast(e.message, 'err');
      }
      resolve();
    };
    const view = h('div', { class: 'confirm' },
      h('h2', {}, done ? 'Mark as done?' : 'Reset progress?'),
      h('p', {}, h('strong', {}, label), ' — ', `${dry.tickets} ticket${dry.tickets === 1 ? '' : 's'}, `, h('strong', {}, `${dry.steps} step${dry.steps === 1 ? '' : 's'}`), done ? ' will be ticked.' : ' will be unticked.'),
      h('p', { class: 'muted small' }, done ? 'Every step inside becomes done, so progress and the overall percentage update everywhere. You can undo right after.' : 'Notes, edits and history are kept; only the ticks are removed. You can undo right after.'),
      h('div', { class: 'cel-actions' },
        h('button', { class: 'btn', onClick: () => { m.close(true); resolve(); } }, 'Cancel'),
        h('button', { class: 'btn ' + (done ? 'primary' : 'danger'), onClick: go }, done ? `Mark ${dry.steps} steps done` : `Reset ${dry.steps} steps`)));
    m = openModal(view, { label: 'Confirm', onClose: resolve });
  });
}
