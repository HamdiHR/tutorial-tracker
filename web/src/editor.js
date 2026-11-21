import { h, debounce, toast, ago } from './dom.js';
import { openModal } from './modal.js';
import { api } from './api.js';
import { renderMarkdown, bindCopy } from './md.js';
import { diffLines, diffStats, renderDiff } from './diff.js';

/** Markdown editor with live preview. Ctrl+S saves, Esc closes (asks if there are unsaved changes). */
export function openEditor(step, onSaved) {
  const title = h('input', { class: 'ed-title', value: step.title, 'aria-label': 'Slide title' });
  const ta = h('textarea', { class: 'ed-text', spellcheck: false, value: step.body, 'aria-label': 'Markdown' });
  const preview = h('div', { class: 'markdown ed-preview' });
  bindCopy(preview);
  const status = h('span', { class: 'muted small' });
  const dirty = () => ta.value !== step.body || title.value.trim() !== step.title;
  const draw = () => {
    preview.innerHTML = renderMarkdown(ta.value);
    status.textContent = dirty() ? 'Unsaved changes' : '';
  };
  const drawSoon = debounce(draw, 160);
  ta.addEventListener('input', drawSoon);
  title.addEventListener('input', () => (status.textContent = dirty() ? 'Unsaved changes' : ''));

  let m;
  const save = async () => {
    if (!dirty()) return m.close(true);
    try {
      await api.saveStep(step.id, title.value, ta.value);
      toast('Saved');
      m.close(true);
      onSaved?.();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value: v } = ta;
      if (s === en) {
        ta.setRangeText('  ', s, en, 'end');
      } else {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const block = v.slice(ls, en);
        const out = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
        ta.setRangeText(out, ls, en, 'select');
      }
      drawSoon();
    }
  });
  title.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  const view = h(
    'div',
    { class: 'editor' },
    h('div', { class: 'ed-head' },
      h('span', { class: 'ed-kicker' }, 'Edit slide'),
      title,
      status,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onClick: save }, 'Save ', h('kbd', {}, 'Ctrl S'))),
    h('div', { class: 'ed-body' }, h('div', { class: 'ed-pane' }, ta), h('div', { class: 'ed-pane preview-pane' }, preview)),
  );
  m = openModal(view, {
    full: true,
    label: 'Edit slide',
    onRequestClose: () => (dirty() ? confirm('Discard your unsaved changes?') : true),
  });
  draw();
  status.textContent = '';
  ta.focus();
  ta.setSelectionRange(0, 0);
}

/** Version list with diff against the current text and one-click restore. */
export async function openHistory(step, onChanged) {
  let data;
  try {
    data = await api.versions(step.id);
  } catch (e) {
    return toast(e.message, 'err');
  }
  const entries = [
    ...data.versions.map((v) => ({ key: 'v' + v.id, label: v.label, when: ago(v.ts), title: v.title, body: v.body })),
    { key: 'orig', label: 'Original (imported)', when: '', title: data.original.title, body: data.original.body, original: true },
  ];
  const list = h('div', { class: 'hist-list' });
  const pane = h('div', { class: 'hist-pane' });
  let m;
  const show = (e) => {
    [...list.children].forEach((c) => c.classList.toggle('on', c.dataset.k === e.key));
    const ops = diffLines(e.body, data.current.body);
    const st = diffStats(ops);
    const same = e.body === data.current.body && e.title === data.current.title;
    pane.replaceChildren(
      h('div', { class: 'hist-bar' },
        h('div', {}, h('strong', {}, e.label), e.when ? h('span', { class: 'muted' }, ' · ' + e.when) : null,
          h('div', { class: 'muted small' }, same ? 'Identical to your current text' : `Changes from this version to now: +${st.add} −${st.del}`)),
        h('span', { class: 'grow' }),
        h('button', {
          class: 'btn', disabled: same,
          onClick: async () => {
            try {
              if (e.original) await api.reset(step.id);
              else await api.saveStep(step.id, e.title, e.body);
              toast(e.original ? 'Reset to original' : 'Version restored');
              m.close(true);
              onChanged?.();
            } catch (err) { toast(err.message, 'err'); }
          },
        }, e.original ? 'Reset to original' : 'Restore this version')),
      renderDiff(ops),
    );
  };
  entries.forEach((e) =>
    list.append(h('button', { class: 'hist-item', dataset: { k: e.key }, onClick: () => show(e) }, h('strong', {}, e.label), h('span', { class: 'muted small' }, e.when || 'first import'))));
  const view = h('div', { class: 'hist' },
    h('div', { class: 'modal-head' }, h('h2', {}, 'History'), h('span', { class: 'muted' }, step.title), h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Close')),
    h('div', { class: 'hist-body' }, list, pane));
  m = openModal(view, { wide: true, label: 'History' });
  show(entries[0]);
}

/** Shown when the .md files changed upstream under a step you edited. */
export function openUpstream(step, onChanged) {
  const ops = diffLines(step.body, step.upstream_body);
  let m;
  const act = (action, msg) => async () => {
    try {
      await api.upstream(step.id, action);
      toast(msg);
      m.close(true);
      onChanged?.();
    } catch (e) { toast(e.message, 'err'); }
  };
  const view = h('div', { class: 'hist' },
    h('div', { class: 'modal-head' }, h('h2', {}, 'Tutorial text changed upstream'), h('span', { class: 'muted' }, step.title), h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: () => m.close() }, 'Later')),
    h('p', { class: 'pad muted' }, 'You edited this slide, and the imported .md file now has different text. Below: your version → the new upstream version.'),
    h('div', { class: 'hist-pane' }, renderDiff(ops)),
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onClick: act('keep', 'Kept your version') }, 'Keep mine'),
      h('button', { class: 'btn primary', onClick: act('accept', 'Upstream text accepted') }, 'Accept upstream (replaces my text)')));
  m = openModal(view, { wide: true, label: 'Upstream changes' });
}
