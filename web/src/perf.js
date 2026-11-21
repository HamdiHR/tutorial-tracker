// Tiny local "slow moments" log: long tasks, slow clicks/keys and slow clipboard writes. Shown in Settings so a
// freeze that only happens on one computer can be pinned down. Nothing leaves the machine.
const KEY = 'perfLog';
let log = [];
try { log = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(log.slice(-40))); } catch {} };
const where = () => location.hash || '#/';
const push = (kind, ms, detail = '') => {
  log.push({ t: Date.now(), kind, ms: Math.round(ms), route: where(), detail });
  log = log.slice(-40);
  save();
};
const describe = (n) => (n && n.tagName ? n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/)[0] : '') : '');

export function noteSlow(kind, ms, detail) { if (ms >= 300) push(kind, ms, detail); }
export const getLog = () => [...log].reverse();
export const clearLog = () => { log = []; save(); };

export function initPerf() {
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration >= 150) push('long task', e.duration); }).observe({ entryTypes: ['longtask'] });
  } catch {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration >= 250 && e.interactionId) push('slow ' + e.name, e.duration, describe(e.target)); }).observe({ type: 'event', durationThreshold: 250, buffered: true });
  } catch {}
}
