import { $, h } from './dom.js';
import { S, ls } from './state.js';
import { renderSidebar, beginNavigation, endNavigation } from './sidebar.js';
import { initPerf } from './perf.js';
import { dashboardView } from './dashboard.js';
import { openSearch } from './search.js';
import { setUnlockHandler, api } from './api.js';
import { startAuth, signOut } from './auth.js';
import { handleUnlocked } from './fx.js';
import { enter } from './motion.js';
import { hasModal } from './modal.js';
import { initPwa } from './pwa.js';
import { engine } from './engine.js';

const root = $('#view');
// Everything except the first screen loads on demand, so the first load stays small.
const VIEWS = {
  t: () => import('./ticket.js'), drift: () => import('./drift.js'), settings: () => import('./settings.js'), manage: () => import('./manage.js'),
  timeline: () => import('./timeline.js'), board: () => import('./board.js'), achievements: () => import('./achievements.js'),
};
const VIEW_FN = { t: 'ticketView', drift: 'driftView', settings: 'settingsView', manage: 'manageView', timeline: 'timelineView', board: 'boardView', achievements: 'achievementsView' };

function theme() {
  const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  return cur;
}
function toggleTheme() {
  const next = theme() === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  ls('theme', next);
  $('#theme-btn').textContent = next === 'light' ? '☾' : '☀';
}

async function route() {
  document.body.classList.remove('nav-open', 'drawer-open');
  root.classList.remove('with-drawer');
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean).map(decodeURIComponent);
  const [view, a, b] = parts;
  const ovP = beginNavigation();
  try {
    if (!S.overview) await ovP; // first load only: the sidebar and views need the data
    const load = VIEWS[view === 't' && !a ? '' : view];
    if (view === 't' && a) await (await VIEWS.t()).ticketView(root, a, b);
    else if (load) await (await load())[VIEW_FN[view]](root, ...(view === 'drift' ? ['open'] : []));
    else await dashboardView(root);
    if (view === 'drift' || view === 'settings') enter(root);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message), h('button', { class: 'btn', onClick: () => location.reload() }, 'Reload')));
  }
  await ovP.catch(() => {});
  endNavigation();
  renderSidebar();
  if (view !== 't') window.scrollTo({ top: 0 });
}

function typing(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!hasModal()) openSearch();
    return;
  }
  if (hasModal() || typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
  const fn = S.keys[e.key] || S.keys[e.key.toLowerCase()];
  if (fn) {
    e.preventDefault();
    fn();
  }
});

setUnlockHandler((list) => handleUnlocked(list, S.overview));
$('#theme-btn').addEventListener('click', toggleTheme);
$('#theme-btn').textContent = theme() === 'light' ? '☾' : '☀';
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#top-search').addEventListener('click', openSearch);
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

function offlineScreen(message) {
  document.body.append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Cannot reach the server'),
    h('p', { class: 'muted' }, message), h('p', { class: 'muted small' }, 'The app opens offline, but your data loads and saves only when you are connected. Offline editing is coming next.'),
    h('button', { class: 'btn primary', onClick: () => location.reload() }, 'Try again'))));
  document.body.classList.add('auth-open');
}

async function boot() {
  // Register the offline shell as early as possible (before the sign-in screen), hosted app only.
  api.config().then((c) => { if (c.hosted) initPwa($('#topbar'), $('#theme-btn'), true); }).catch(() => {});
  try { await startAuth(); } catch (e) { return offlineScreen(e.message); }
  if (S.hosted) {
    try { S.me = await api.me(); try { localStorage.setItem('tt.me', JSON.stringify(S.me)); } catch {} }
    catch (e) {
      const net = e.network || /Cannot reach/.test(e.message);
      if (net) await engine.settled(); // offline: the engine is starting from this device's copy; wait for it
      let cached = null; try { cached = net ? JSON.parse(localStorage.getItem('tt.me') || 'null') : null; } catch {}
      if (cached && engine.status() === 'ready' && engine.source() === 'device') { S.me = cached; S.offline = true; } // offline: this device's copy of the data
      else if (net) return offlineScreen(e.message);
      else {
      document.body.append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'No access'), h('p', { class: 'muted' }, e.message), h('button', { class: 'btn', onClick: signOut }, 'Sign out'))));
      document.body.classList.add('auth-open');
      return;
      }
    }
    if (!S.me.onboarded) {
      await (await import('./onboarding.js')).runOnboarding();
      S.me = await api.me().catch(() => S.me);
      try { localStorage.setItem('tt.me', JSON.stringify(S.me)); } catch {}
    }
    const who = h('button', { class: 'btn sm', title: S.me.email, onClick: () => { location.hash = '#/settings'; } }, 'Account');
    $('#topbar').insertBefore(who, $('#theme-btn'));
  }
  window.addEventListener('hashchange', route);
  initPerf();
  route();
  // Shareable task link: /?t=<ticket id> opens that task's drawer.
  try { const t = new URL(location.href).searchParams.get('t'); if (t) import('./drawer.js').then((m) => m.openDrawer(t)); } catch {}
}
boot();
// Warm the most used screen while the browser is idle, so the first click is instant.
(window.requestIdleCallback || setTimeout)(() => { VIEWS.t(); import('./md-core.js'); }, { timeout: 3000 });
