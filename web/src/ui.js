import { h } from './dom.js';

export const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];

/** Hexagon medal. tier: 0-4 (Bronze..Diamond) or -1 for locked. */
export function medal(icon, tier = -1, cls = '') {
  return h('span', { class: `medal ${cls} ${tier < 0 ? 'locked' : 't' + tier}` }, h('i', {}, icon));
}

/** Circular progress. The fill animates from 0 to `value` (0-100) on first paint. */
export function ring(value, inner, cls = '') {
  const el = h('div', { class: 'ring2 ' + cls, role: 'img', 'aria-label': `${Math.round(value)}%` }, h('span', { class: 'ring-in' }, inner));
  requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--p', value)));
  return el;
}

export const greeting = () => {
  const hr = new Date().getHours();
  return hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
};

/** Round avatar with the person's initial and colour. */
export const avatar = (m, cls = '') => h('span', { class: 'avatar ' + cls, style: { '--mc': m?.color || 'var(--accent)' }, title: m?.name || '' }, (m?.name || '?').trim().slice(0, 1).toUpperCase());
