import { h, bar, pct, ago } from './dom.js';
import { S } from './state.js';
import { api } from './api.js';
import { medal, ring, TIER_NAMES } from './ui.js';
import { countUp, enter } from './motion.js';

export async function achievementsView(root) {
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Achievements — Tutorial Tracker';
  let a;
  try { a = await api.achievements(); } catch (e) { return root.replaceChildren(h('p', { class: 'pad' }, e.message)); }
  const p = a.player;
  const span = p.levelNext - p.levelStart;
  const into = p.xp - p.levelStart;

  const lvl = h('b', {}, '1');
  countUp(lvl, p.level, { ms: 700 });
  const xp = h('strong', {}, '0');
  countUp(xp, p.xp, { ms: 1000, fmt: (n) => Math.round(n).toLocaleString() });

  const head = h('section', { class: 'ach-hero' },
    ring(pct(into, span), lvl, 'big lvl-ring'),
    h('div', { class: 'ach-hero-body' },
      h('div', { class: 'kicker' }, 'Your level'),
      h('h1', {}, `Level ${p.level} · ${p.title}`),
      h('div', { class: 'row' }, h('div', { class: 'grow-bar' }, bar(into, span, 'xp')), h('span', { class: 'muted small' }, `${span - into} XP to level ${p.level + 1}`)),
      h('div', { class: 'ach-meta' }, h('span', {}, xp, ' XP total'), h('span', {}, h('b', {}, `${p.unlocked}/${p.total}`), ' achievements'), h('span', {}, h('b', {}, `${a.stats.tickets}/${a.stats.ticketsTotal}`), ' tickets'))));

  const cards = a.badges.map((b, i) => {
    const reached = b.reached;
    const pips = h('div', { class: 'pips' }, b.tiers.map((t, k) => h('span', { class: 'pip2' + (t.unlocked ? ' on t' + k : ''), title: `${t.name}: ${t.n} ${b.unit}${t.at ? ' · ' + ago(t.at) : ''}` }, t.n)));
    return h('article', { class: 'ach-card' + (reached ? '' : ' locked'), style: { '--i': i } },
      medal(b.icon, reached ? reached - 1 : -1, 'lg'),
      h('div', { class: 'ach-body' },
        h('div', { class: 'ach-title' }, h('strong', {}, b.title), reached ? h('span', { class: 'tier-chip t' + (reached - 1) }, TIER_NAMES[reached - 1]) : h('span', { class: 'tier-chip none' }, 'Locked')),
        h('div', { class: 'muted small' }, b.blurb),
        b.next !== null
          ? h('div', { class: 'ach-prog' }, bar(Math.min(b.value, b.next), b.next), h('span', { class: 'muted small' }, `${b.value} / ${b.next} ${b.unit}`))
          : h('div', { class: 'small done-line' }, `✓ Top tier reached · ${b.value} ${b.unit}`),
        pips));
  });

  const trophies = a.trophies.map((t, i) =>
    h('article', { class: 'trophy' + (t.complete ? ' on' : ''), style: { '--i': i }, title: t.title },
      h('span', { class: 'tr-ic' }, '🏆'),
      h('strong', {}, 'Sprint ' + t.sprintId),
      h('span', { class: 'muted small ell' }, t.title.replace(/^Sprint\s+[\d.]+\s*[—–-]\s*/i, '')),
      t.complete ? h('span', { class: 'small done-line' }, t.at ? '✓ ' + ago(t.at) : '✓ Completed') : h('div', { class: 'tr-prog' }, bar(t.done, t.total, 'thin'), h('span', { class: 'muted small' }, `${t.done}/${t.total}`))));

  root.replaceChildren(h('div', { class: 'dash' },
    head,
    h('h2', { class: 'sec-title' }, 'Badges'),
    h('div', { class: 'ach-grid' }, cards),
    h('h2', { class: 'sec-title' }, 'Sprint trophies'),
    h('div', { class: 'trophies' }, trophies),
    h('p', { class: 'muted small foot-note' }, 'XP: 10 per step · 50 per ticket · 250 per sprint · 10 per slide you fix · 5 per note or verified drift item. Badges are never taken away, even if you reset progress later.')));
  enter(root);
}
