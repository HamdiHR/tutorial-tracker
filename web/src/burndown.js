// Burndown: steps still to do, per day. Dashed = plan, solid = reality, so a line above the dashed one means behind.
import { h } from './dom.js';
const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}, ...k) => { const e = document.createElementNS(NS, n); for (const [x, v] of Object.entries(a)) e.setAttribute(x, v); e.append(...k.filter(Boolean)); return e; };

export function burndown(sch) {
  const b = sch.burn;
  if (!b || b.days.length < 2 || !b.scope) return null;
  const W = 640, H = 150, L = 34, R = 8, T = 10, B = 20, n = b.days.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / b.scope) * (H - T - B);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ti = b.days.indexOf(sch.today.date);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bd-svg', role: 'img', 'aria-label': `Burndown: ${b.left} of ${b.scope} steps left` },
    ...[0, 0.5, 1].map((f) => el('g', {}, el('line', { x1: L, x2: W - R, y1: y(b.scope * f), y2: y(b.scope * f), class: 'bd-grid' }), (() => { const t = el('text', { x: L - 4, y: y(b.scope * f) + 3, class: 'bd-ax', 'text-anchor': 'end' }); t.textContent = Math.round(b.scope * f); return t; })())),
    el('path', { d: path(b.planned), class: 'bd-plan' }),
    el('path', { d: path(b.actual), class: 'bd-act' }),
    el('circle', { cx: x(b.actual.length - 1), cy: y(b.actual.at(-1)), r: 4, class: 'bd-dot' }),
    ti >= 0 ? el('line', { x1: x(ti), x2: x(ti), y1: T, y2: H - B, class: 'bd-today' }) : null,
    ...[0, n - 1].map((i) => { const t = el('text', { x: x(i), y: H - 5, class: 'bd-ax', 'text-anchor': i ? 'end' : 'start' }); t.textContent = b.days[i].slice(5); return t; }));
  const p = ti >= 0 ? b.planned[ti] : null;
  const diff = p == null ? null : b.left - p;
  return h('section', { class: 'card bd-card' },
    h('div', { class: 'row gap wrap' }, h('h3', { class: 'bd-h' }, 'Burndown'), h('span', { class: 'muted small' }, `${b.left} of ${b.scope} steps left`
      + (diff == null ? '' : diff > 0 ? ` · ${diff} behind plan` : diff < 0 ? ` · ${-diff} ahead of plan` : ' · exactly on plan')),
    h('span', { class: 'sp' }), h('span', { class: 'bd-key' }, h('i', { class: 'k plan' }), 'plan ', h('i', { class: 'k act' }), 'you')), svg);
}
