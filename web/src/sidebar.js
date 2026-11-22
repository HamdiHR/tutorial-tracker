import { h, bar, pct } from './dom.js';
import { S, sprintLabel, sprintName, shortId } from './state.js';
import { api } from './api.js';
import { openSearch } from './search.js';
import { levelUp } from './fx.js';

const dot = (status) => h('i', { class: 'dot ' + status, title: status });

let lastSig = '';
/** Cheap fingerprint of everything the sidebar shows, so unchanged data never rebuilds the tree. */
function signature(ov, route) {
  let s = route + '|' + S.activeTicket + '|' + ov.player.xp + '|' + ov.player.unlocked + '|' + ov.driftOpen + '|';
  for (const sp of ov.sprints) {
    s += sp.id + ':' + sp.done + '/' + sp.total + (sp.complete ? 'c' : '');
    for (const t of sp.items) s += t.status[0] + t.done + (t.upstream ? 'u' : '');
    s += ';';
  }
  return s;
}

export function renderSidebar() {
  const root = document.getElementById('side');
  const ov = S.overview;
  if (!ov) return;
  const route = (location.hash.slice(1) || '/').split('/')[1] || '';
  const sig = signature(ov, route);
  if (sig === lastSig && root.firstChild) return;
  lastSig = sig;
  const pl = ov.player;

  const player = h('a', { class: 'player', href: '#/achievements', title: 'Your level and achievements' },
    h('span', { class: 'lvl' }, h('b', {}, pl.level)),
    h('div', { class: 'pl-body' },
      h('div', { class: 'pl-top' }, h('strong', {}, pl.title), h('span', { class: 'muted small' }, `${pl.xp - pl.levelStart} / ${pl.levelNext - pl.levelStart} XP`)),
      bar(pl.xp - pl.levelStart, pl.levelNext - pl.levelStart, 'thin xp')));

  const link = (href, key, icon, label, extra) => h('a', { href, class: route === key ? 'on' : '' }, h('span', { class: 'ni' }, icon), label, extra || null);
  const nav = h('nav', { class: 'nav' },
    link('#/', '', '◧', 'Dashboard'),
    link('#/board', 'board', '▦', 'Board'),
    link('#/timeline', 'timeline', '🗓', 'Timeline'),
    link('#/manage', 'manage', '☑', 'Manage progress'),
    link('#/achievements', 'achievements', '✦', 'Achievements', h('span', { class: 'badge soft' }, `${pl.unlocked}/${pl.total}`)),
    link('#/drift', 'drift', '⚑', 'Drift inbox', ov.driftOpen ? h('span', { class: 'badge' }, ov.driftOpen) : null),
    link('#/settings', 'settings', '⚙', 'Settings'));

  const tree = h('div', { class: 'tree' });
  const currentSprint = ov.sprints.find((sp) => sp.items.some((t) => t.id === S.activeTicket))?.id;
  for (const sp of ov.sprints) {
    const tickets = sp.items.filter((t) => t.kind === 'ticket');
    const refs = sp.items.filter((t) => t.kind === 'ref');
    const open = S.openSprints.has(sp.id) || sp.id === currentSprint;
    const d = h('details', { class: 'sprint' + (sp.complete ? ' complete' : ''), open, onToggle: (e) => (e.target.open ? S.openSprints.add(sp.id) : S.openSprints.delete(sp.id)) },
      h('summary', {}, h('span', { class: 'sp-id' }, sprintLabel(sp)), h('span', { class: 'sp-name', title: sp.title }, sprintName(sp)), h('span', { class: 'sp-pct' }, sp.complete ? '✓' : `${pct(sp.done, sp.total)}%`)),
      bar(sp.done, sp.total, 'thin'));
    for (const t of tickets) d.append(item(t));
    if (refs.length) d.append(h('details', { class: 'refs', open: refs.some((r) => r.id === S.activeTicket) }, h('summary', {}, `Reference · ${refs.length}`), refs.map((r) => item(r))));
    tree.append(d);
  }

  const scroll = root.querySelector('.tree')?.scrollTop ?? 0;
  root.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '▤'), h('strong', {}, 'Tutorial Tracker'), h('span', { class: 'ver', title: `Version ${__APP_VERSION__}` }, 'v' + __APP_VERSION__.split('.').slice(0, 2).join('.'))),
    player,
    h('button', { class: 'search-btn', onClick: openSearch }, h('span', {}, 'Search'), h('kbd', {}, 'Ctrl K')),
    nav,
    tree,
  );
  root.querySelector('.tree').scrollTop = scroll;
  root.querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
}

function item(t) {
  const ref = t.kind === 'ref';
  return h('a', { class: 'item' + (t.id === S.activeTicket ? ' on' : '') + (t.deferred ? ' deferred' : ''), href: `#/t/${encodeURIComponent(t.id)}`, title: t.title },
    ref ? h('i', { class: 'dot ref' }) : dot(t.status),
    ref ? null : h('span', { class: 'tid' }, shortId(t.id)),
    h('span', { class: 'tt' }, t.title),
    t.upstream ? h('span', { class: 'flag', title: 'Upstream text changed' }, '↯') : null,
    !ref && t.status === 'doing' ? h('span', { class: 'frac' }, `${t.done}/${t.total}`) : null);
}

async function fetchOverview() {
  const prev = S.overview?.player?.level;
  S.overview = await api.overview();
  renderSidebar();
  if (prev && S.overview.player.level > prev) levelUp(S.overview.player);
  return S.overview;
}

// One overview request per navigation: the router starts it, and any view asking for a refresh while that
// navigation is running shares the same request instead of firing another.
let nav = null;
export function beginNavigation() {
  nav = fetchOverview();
  nav.catch(() => {});
  return nav;
}
export const endNavigation = () => { nav = null; };
export const refreshOverview = () => nav || fetchOverview();

/**
 * Apply the result of a progress change (the server returns the updated ticket and player card) to the
 * cached overview, so the sidebar and counters update without another round trip.
 */
export function patchTicket(sum, player) {
  const ov = S.overview;
  if (!ov || !sum) return;
  for (const sp of ov.sprints) {
    const t = sp.items.find((i) => i.id === sum.id);
    if (!t) continue;
    Object.assign(t, { status: sum.status, override: sum.override, total: sum.total, done: sum.done });
    const real = sp.items.filter((i) => i.kind === 'ticket' && !i.deferred);
    sp.total = real.reduce((a, i) => a + i.total, 0);
    sp.done = real.reduce((a, i) => a + i.done, 0);
    sp.ticketsDone = real.filter((i) => i.status === 'done').length;
    sp.complete = real.length > 0 && real.every((i) => i.status === 'done');
    break;
  }
  const real = ov.sprints.flatMap((sp) => sp.items).filter((i) => i.kind === 'ticket' && !i.deferred);
  ov.totals.steps = real.reduce((a, i) => a + i.total, 0);
  ov.totals.stepsDone = real.reduce((a, i) => a + i.done, 0);
  ov.totals.byStatus = real.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {});
  const prev = ov.player?.level;
  if (player) ov.player = player;
  renderSidebar();
  if (player && prev && player.level > prev) levelUp(player);
}
