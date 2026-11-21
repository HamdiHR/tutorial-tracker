import { h } from './dom.js';

const stack = [];

/** Opens a modal. opts.onRequestClose() may return false to veto closing (e.g. unsaved changes). */
export function openModal(content, opts = {}) {
  const prevFocus = document.activeElement;
  const box = h('div', { class: 'modal-box' + (opts.wide ? ' wide' : '') + (opts.full ? ' full' : '') + (opts.celebrate ? ' cel' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || 'Dialog' }, content);
  const back = h('div', { class: 'modal' + (opts.top ? ' top' : '') }, box);
  const m = {
    el: back,
    close(force = false) {
      if (!force && opts.onRequestClose && opts.onRequestClose() === false) return false;
      const i = stack.indexOf(m);
      if (i >= 0) stack.splice(i, 1);
      back.remove();
      if (!stack.length) document.body.classList.remove('modal-open');
      opts.onClose?.();
      try { prevFocus?.focus?.(); } catch {}
      return true;
    },
  };
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) m.close();
  });
  stack.push(m);
  document.body.classList.add('modal-open');
  document.body.append(back);
  return m;
}

export const hasModal = () => stack.length > 0;
export const closeTopModal = () => stack.at(-1)?.close();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    e.stopPropagation();
    closeTopModal();
  }
}, true);
