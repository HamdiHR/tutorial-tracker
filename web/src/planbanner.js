import { h } from './dom.js';
import { api } from './api.js';
import { todayStr, fmtDate, plural } from './dates.js';

/** Small status line for the dashboard. Resolves to null when there is no plan. */
export async function planBanner() {
  let data;
  try { data = await api.plan(todayStr()); } catch { return null; }
  if (!data.plan) return h('a', { class: 'tl-banner', href: '#/timeline' }, h('span', {}, '🗓'), h('span', { class: 'grow' }, h('strong', {}, 'Plan your timeline'), ' — set a start date and pace, and I\'ll tell you if you\'re on track.'), h('span', {}, 'Set up →'));
  const td = data.schedule.today;
  const d = td.deltaSteps;
  const msg = data.schedule.projectedEnd === 'done' ? 'Course finished 🎉' : d === 0 ? 'Right on plan' : d > 0 ? `${d} steps ahead of plan` : `${-d} steps behind plan`;
  const tone = data.schedule.projectedEnd === 'done' || d >= 0 ? 'ok' : d < -Math.max(5, td.totalSteps * 0.03) ? 'late' : '';
  return h('a', { class: 'tl-banner ' + tone, href: '#/timeline' }, h('span', {}, '🗓'),
    h('span', { class: 'grow' }, h('strong', {}, msg), td.dueTickets ? ` · ${plural(td.dueTickets, 'ticket')} due by today` : '', ` · planned finish ${fmtDate(data.schedule.plannedEnd, true)}`), h('span', {}, 'Timeline →'));
}
