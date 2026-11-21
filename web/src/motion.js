// Small motion helpers. Everything respects "reduce motion" (the OS setting).
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate a number inside `el`. */
export function countUp(el, to, { from = 0, ms = 900, fmt = (n) => String(Math.round(n)) } = {}) {
  if (reduceMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Restart the page-enter animation on a container (children rise in, staggered by CSS). */
export function enter(el) {
  // Entrance animation plays once per navigation, not when a view re-renders itself (filters, drags, edits).
  if (el.dataset.enterKey === location.hash) return;
  el.dataset.enterKey = location.hash;
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
}

/** "+10 XP" style text that floats up from an element. */
export function floatText(anchor, text, cls = '') {
  if (reduceMotion() || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'float-text ' + cls;
  el.textContent = text;
  el.style.left = r.left + r.width / 2 + 'px';
  el.style.top = r.top + 'px';
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1600);
}
