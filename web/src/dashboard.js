import { h, bar, pct, ago } from './dom.js';
import { S, sprintLabel, sprintName, shortId, STATUS_LABEL } from './state.js';
import { refreshOverview } from './sidebar.js';
import { runBulk } from './bulkui.js';
import { ring, greeting } from './ui.js';
import { countUp, enter } from './motion.js';
import { planBanner } from './planbanner.js';

const link = (id, stepId) => `#/t/${encodeURIComponent(id)}${stepId ? '/' + stepId : ''}`;
const ICONS = { 0: '🏗️', 1: '🗄️', 2: '🔐', 2.3: '☁️', 2.6: '📱', 3: '✨', 4: '🏢', 5: '🧪', 6: '📈', 7: '🔎', 8: '🚀' };
const hue = (i) => (215 + i * 41) % 360;

function counter(to, fmt) {
  const el = h('span', {}, fmt ? fmt(0) : '0');
  countUp(el, to, { fmt });
  return el;
}

function sprintMenu(sp, again) {
  let menu;
  const close = () => { menu?.remove(); menu = null; document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (menu && !menu.contains(e.target)) close(); };
  const btn = h('button', { class: 'icon-btn sm kebab', 'aria-label': `Actions for ${sprintLabel(sp)}`, 'aria-haspopup': 'menu', onClick: (e) => {
    e.stopPropagation();
    if (menu) return close();
    menu = h('div', { class: 'menu', role: 'menu' },
      h('button', { role: 'menuitem', disabled: sp.complete, onClick: () => { close(); runBulk('done', { sprintIds: [sp.id] }, sprintLabel(sp), again); } }, '✓ Mark sprint done'),
      h('button', { role: 'menuitem', disabled: !sp.done, onClick: () => { close(); runBulk('reset', { sprintIds: [sp.id] }, sprintLabel(sp), again); } }, '↺ Reset sprint'),
      h('a', { role: 'menuitem', href: '#/manage' }, '☑ Manage progress…'));
    btn.parentElement.append(menu);
    document.addEventListener('mousedown', outside, true);
  } }, '⋯');
  return h('div', { class: 'kebab-wrap' }, btn);
}

export async function dashboardView(root) {
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Dashboard — Tutorial Tracker';
  root.replaceChildren(h('p', { class: 'muted pad' }, 'Loading…'));
  const ov = await refreshOverview();
  const again = () => dashboardView(root);
  const T = ov.totals;
  const P = ov.player;
  const p = pct(T.stepsDone, T.steps);
  const cur = ov.current;
  const allDone = T.steps > 0 && T.stepsDone >= T.steps;

  // ---- hero: continue + level
  const hero = h('section', { class: 'hero2' },
    h('div', { class: 'hero-main' },
      h('div', { class: 'kicker' }, greeting() + ' 👋'),
      allDone
        ? h('h1', {}, 'You finished the whole course 🎉')
        : h('h1', {}, ov.doneToday ? `${ov.doneToday} step${ov.doneToday === 1 ? '' : 's'} done today. Keep it going.` : 'Ready for the next step?'),
      cur && !allDone
        ? h('div', { class: 'resume' },
            h('div', { class: 'resume-info' },
              h('div', { class: 'resume-t' }, h('span', { class: 'chip' }, cur.ticketId.replace(/-ref-/, ' ref ')), h('strong', {}, cur.title)),
              cur.stepTitle ? h('div', { class: 'muted small ell' }, 'Last slide · ' + cur.stepTitle.replace(/^\d+(\.\d+)*\.?\s*/, '')) : null,
              h('div', { class: 'row' }, h('div', { class: 'grow-bar' }, bar(cur.done, cur.total)), h('span', { class: 'muted small' }, `${cur.done}/${cur.total} steps`))),
            h('a', { class: 'btn primary lg glow', href: link(cur.ticketId, cur.stepId) }, cur.done ? 'Resume →' : 'Start →'))
        : null),
    h('a', { class: 'level-card', href: '#/achievements', title: 'Open achievements' },
      ring(pct(P.xp - P.levelStart, P.levelNext - P.levelStart), counter(P.level), 'lvl-ring'),
      h('div', {}, h('div', { class: 'kicker' }, 'Level'), h('strong', { class: 'lvl-title' }, P.title),
        h('div', { class: 'muted small' }, `${P.levelNext - P.xp} XP to level ${P.level + 1}`),
        h('div', { class: 'ach-link' }, `✦ ${P.unlocked}/${P.total} achievements →`))));

  // ---- stat tiles
  const tile = (icon, label, value, sub, extra) => h('div', { class: 'tile-stat' }, h('span', { class: 'ts-ic' }, icon), h('div', {}, h('div', { class: 'stat-l' }, label), h('div', { class: 'stat-v' }, value), sub ? h('div', { class: 'muted small' }, sub) : null, extra || null));
  const stats = h('section', { class: 'stats' },
    h('div', { class: 'tile-stat prog' },
      ring(p, counter(p, (n) => Math.round(n) + '%'), 'md'),
      h('div', {}, h('div', { class: 'stat-l' }, 'Overall progress'), h('div', { class: 'stat-v' }, counter(T.stepsDone), ' ', h('span', { class: 'muted of' }, '/ ' + T.steps)), h('div', { class: 'muted small' }, 'steps completed'))),
    tile('🎫', 'Tickets done', h('span', {}, counter(T.byStatus.done || 0), h('span', { class: 'muted of' }, ' / ' + T.tickets)), `${T.byStatus.doing || 0} in progress${T.byStatus.test ? ` · ${T.byStatus.test} testing` : ''}${T.byStatus.blocked ? ` · ${T.byStatus.blocked} blocked` : ''}`),
    tile('🔥', 'Streak', h('span', {}, counter(ov.streak), h('span', { class: 'muted of' }, ov.streak === 1 ? ' day' : ' days')), ov.doneToday ? `${ov.doneToday} step${ov.doneToday === 1 ? '' : 's'} today` : 'complete a step to keep it'),
    tile('⚑', 'Drift inbox', counter(ov.driftOpen), null, h('a', { href: '#/drift', class: 'small' }, 'items to verify →')));

  // ---- courses (sprints)
  const courses = h('div', { class: 'courses' }, ov.sprints.map((sp, i) => {
    const tickets = sp.items.filter((t) => t.kind === 'ticket');
    const first = tickets.find((t) => t.status !== 'done' && t.status !== 'deferred') || tickets[0];
    const cta = sp.complete ? 'Review' : sp.done ? 'Continue' : 'Start';
    const hh = hue(i);
    return h('article', { class: 'course' + (sp.complete ? ' complete' : ''), style: { '--h': hh, '--i': i } },
      h('div', { class: 'course-top' },
        h('span', { class: 'course-ic' }, ICONS[sp.id] || '📘'),
        h('span', { class: 'course-id' }, sprintLabel(sp)),
        sp.complete ? h('span', { class: 'course-done', title: 'Sprint complete' }, '✓ Complete') : null,
        h('span', { class: 'grow' }),
        sprintMenu(sp, again)),
      h('h3', { class: 'course-title' }, sprintName(sp)),
      h('div', { class: 'course-prog' },
        ring(pct(sp.done, sp.total), h('span', { class: 'pct' }, pct(sp.done, sp.total) + '%'), 'sm'),
        h('div', {}, h('div', { class: 'small' }, h('strong', {}, sp.ticketsDone), ` / ${sp.ticketsTotal} tickets`), h('div', { class: 'muted small' }, `${sp.done} / ${sp.total} steps`))),
      h('div', { class: 'tiles' }, tickets.map((t) => h('a', { class: 'tile ' + t.status, href: link(t.id), title: `${t.id} · ${t.title} — ${STATUS_LABEL[t.status]}${t.total ? ` (${t.done}/${t.total})` : ''}`, 'aria-label': `${t.id} ${STATUS_LABEL[t.status]}` }, shortId(t.id).replace('T', '')))),
      h('a', { class: 'btn course-cta' + (sp.complete ? '' : ' primary'), href: first ? link(first.id) : '#/' }, cta + ' →'));
  }));
  const legend = h('div', { class: 'legend' }, ['todo', 'doing', 'done', 'blocked', 'test', 'deferred'].map((s) => h('span', {}, h('i', { class: 'dot ' + s }), STATUS_LABEL[s])));

  const next = ov.nextUp.length
    ? h('section', { class: 'card' }, h('h3', {}, 'Next up'),
        h('div', { class: 'list' }, ov.nextUp.map((t) => h('a', { class: 'row-link', href: link(t.id) }, h('i', { class: 'dot ' + t.status }), h('span', { class: 'chip' }, t.id), h('span', { class: 'grow ell' }, t.title), h('span', { class: 'muted small' }, t.total ? `${t.done}/${t.total}` : '')))))
    : h('section', { class: 'card' }, h('h3', {}, 'Next up'), h('p', { class: 'muted' }, 'Nothing left. 🎉'));

  const max = Math.max(1, ...ov.activity.map((a) => a.n));
  const act = h('section', { class: 'card' }, h('h3', {}, 'Last 30 days'),
    h('div', { class: 'spark', role: 'img', 'aria-label': 'Steps completed per day, last 30 days' }, ov.activity.map((a, i) => h('i', { class: a.n ? 'on' : '', title: `${a.day}: ${a.n} step${a.n === 1 ? '' : 's'}`, style: { height: Math.max(a.n ? 12 : 4, (a.n / max) * 100) + '%', '--i': i } }))),
    h('div', { class: 'muted small' }, `${ov.activity.reduce((a, b) => a + b.n, 0)} steps completed`));

  const recent = h('section', { class: 'card' }, h('h3', {}, 'Recent edits & notes'),
    ov.recent.length
      ? h('div', { class: 'list' }, ov.recent.map((r) => h('a', { class: 'row-link', href: link(r.ticket_id, r.step_id) }, h('span', { class: 'chip ' + r.type }, r.type), h('span', { class: 'grow ell' }, (r.step_title || '').replace(/^\d+(\.\d+)*\.?\s*/, '') || r.ticket_title), h('span', { class: 'muted small' }, ago(r.ts)))))
      : h('p', { class: 'muted' }, 'Your edits and notes will show up here.'));

  const slot = h('div', { class: 'banner-slot' });
  planBanner().then((b) => { if (b && slot.isConnected) slot.replaceChildren(b); }).catch(() => {});
  root.replaceChildren(h('div', { class: 'dash' },
    hero, stats, slot,
    h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, 'Your sprints'), h('a', { class: 'link', href: '#/manage' }, 'Manage progress →')),
    courses, legend,
    h('div', { class: 'grid2' }, next, act), recent));
  enter(root);
}
