// Installable app (PWA): registers the offline shell, shows an Install button when the browser allows it,
// tells you when a new version is ready (and only reloads when you press the button), and shows an offline notice.
import { h } from './dom.js';
import { S } from './state.js';

const swOk = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let deferred = null;
let installBtn = null;
let banner = null;

function showBar(key, node) {
  document.querySelector(`[data-bar="${key}"]`)?.remove();
  if (!node) return;
  node.dataset.bar = key;
  document.body.append(node);
}

function updateBar(reg) {
  showBar('update', h('div', { class: 'pwa-bar', role: 'status' },
    h('span', {}, 'A new version is ready.'),
    h('button', { class: 'btn sm primary', type: 'button', onClick: () => {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      reg.waiting?.postMessage('SKIP_WAITING');
    } }, 'Reload'),
    h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Later', onClick: () => showBar('update', null) }, '✕')));
}

function offlineBar() {
  showBar('offline', navigator.onLine ? null : h('div', { class: 'pwa-bar off', role: 'status' }, h('span', {}, 'You are offline. You can open the app, but your data loads and saves only when you are back online.')));
}

async function register() {
  if (!swOk) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    const watch = (w) => w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBar(reg); });
    if (reg.waiting && navigator.serviceWorker.controller) updateBar(reg);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
  } catch (e) { console.warn('Offline mode unavailable:', e.message); }
}

export function initPwa(topbar, before, force = false) {
  if (!force && !S.hosted && localStorage.getItem('tt.sw') !== '1') return; // the local app already runs on your own machine
  installBtn = h('button', { id: 'install-btn', class: 'btn sm', type: 'button', hidden: true, title: 'Install this app on your device', onClick: async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null; installBtn.hidden = true;
  } }, '⤓ Install app');
  topbar?.insertBefore(installBtn, before || null);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!standalone()) installBtn.hidden = false; });
  window.addEventListener('appinstalled', () => { deferred = null; installBtn.hidden = true; });
  window.addEventListener('online', offlineBar);
  window.addEventListener('offline', offlineBar);
  offlineBar();
  register();
}
