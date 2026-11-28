// Settings cards for the hosted version: account, starting point, people (owner only).
import { h, toast } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { signOut, changePassword } from './auth.js';
import { refreshOverview } from './sidebar.js';
import { engine } from './engine.js';

export function accountCards(sec) {
  const me = S.me || {};
  const start = me.start?.mode === 'point' ? `Started at ${me.start.ticket}${me.start.markedPrevious ? ', earlier work marked done' : ''}` : 'Started from the beginning';
  const cards = [
    sec('Account',
      h('p', {}, h('strong', {}, me.email || ''), ' ', h('span', { class: 'chip' }, me.role || 'member')),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', onClick: signOut }, 'Sign out'))),
    syncCard(sec),
    passwordCard(sec),
    sec('Starting point',
      h('p', { class: 'muted' }, start + '.'),
      h('p', { class: 'muted small' }, 'Changing it resets your ticked steps (notes and edits stay) and applies the new choice.'),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', onClick: async () => {
        try {
          await (await import('./onboarding.js')).runOnboarding({ redo: true, cancelable: true });
        } catch { return; }
        S.me = await api.me().catch(() => S.me);
        await refreshOverview();
        location.hash = '#/';
        toast('Starting point updated');
      } }, 'Change starting point…'))),
  ];
  if (me.role === 'owner') cards.push(peopleCard(sec));
  return cards;
}

function peopleCard(sec) {
  const list = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Loading…'));
  const msg = h('p', { class: 'muted small' });
  const input = h('input', { class: 'text-input', type: 'email', placeholder: 'friend@example.com', 'aria-label': 'Email to invite', required: true });
  const draw = async () => {
    try {
      const { people } = await api.people();
      list.replaceChildren(...people.map((p) => h('div', { class: 'row-link' },
        h('span', { class: 'grow ell' }, p.email),
        h('span', { class: 'chip' }, p.role === 'owner' ? 'owner' : p.joined ? (p.onboarded ? 'active' : 'joined') : 'invited'),
        !p.joined ? h('button', { class: 'btn sm', onClick: async () => { try { await api.revoke(p.email); draw(); } catch (e) { toast(e.message, 'err'); } } }, 'Remove') : null)));
    } catch (e) { list.replaceChildren(h('p', { class: 'muted' }, e.message)); }
  };
  const form = h('form', { class: 'row gap wrap', onSubmit: async (e) => {
    e.preventDefault();
    try { const r = await api.invite(input.value); msg.textContent = r.note; input.value = ''; draw(); }
    catch (err) { msg.textContent = err.message; }
  } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Invite'));
  draw();
  return sec('People',
    h('p', { class: 'muted' }, 'Only invited emails can create an account. Each person has their own progress, notes, board and timeline.'),
    form, msg, list);
}

function passwordCard(sec) {
  const msg = h('p', { class: 'muted small', role: 'status' });
  const a = h('input', { class: 'text-input', type: 'password', minlength: 8, required: true, autocomplete: 'new-password', placeholder: 'New password (8+ characters)', 'aria-label': 'New password' });
  const b = h('input', { class: 'text-input', type: 'password', minlength: 8, required: true, autocomplete: 'new-password', placeholder: 'Repeat new password', 'aria-label': 'Repeat new password' });
  const form = h('form', { class: 'row gap wrap', onSubmit: async (e) => {
    e.preventDefault();
    if (a.value !== b.value) { msg.textContent = 'The two passwords do not match.'; return; }
    try { await changePassword(a.value); a.value = b.value = ''; msg.textContent = 'Password changed.'; }
    catch (err) { msg.textContent = err.message; }
  } }, a, b, h('button', { class: 'btn', type: 'submit' }, 'Change password'));
  return sec('Password', form, msg);
}

const LABELS = [
  [/^\/api\/steps\/\d+\/done$/, 'Tick or untick a step'], [/^\/api\/steps\/\d+\/note$/, 'Step note'], [/^\/api\/steps\/\d+\/reset$/, 'Reset a step'],
  [/^\/api\/steps\/\d+$/, 'Edit a step'], [/^\/api\/tickets\/[^/]+\/note$/, 'Task note'], [/^\/api\/tickets\/[^/]+\/status$/, 'Task status'],
  [/^\/api\/tickets\/[^/]+\/extras$/, 'Task details'], [/^\/api\/plan/, 'Timeline plan'], [/^\/api\/resume$/, 'Where you are'], [/^\/api\/views$/, 'Saved filters'], [/^\/api\/bulk/, 'Mark many steps'],
];
const label = (o) => LABELS.find(([re]) => re.test(o.path))?.[1] || `${o.method} ${o.path}`;
const when = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

function syncCard(sec) {
  const body = h('div', {});
  const msg = h('p', { class: 'muted small', role: 'status' });
  const draw = () => {
    const pend = engine.pendingList(), fails = engine.failedList(), conf = engine.conflictCount();
    const online = navigator.onLine !== false;
    body.replaceChildren(
      h('p', {}, h('span', { class: 'chip' }, online ? 'online' : 'offline'), ' ', h('span', { class: 'muted' }, `Last synced: ${when(engine.lastSync())}`)),
      pend.length
        ? h('div', {}, h('p', {}, `${pend.length} change${pend.length > 1 ? 's' : ''} saved on this device, waiting to upload:`),
            h('div', { class: 'list' }, ...pend.slice(0, 30).map((o) => h('div', { class: 'row-link' }, h('span', { class: 'grow ell' }, label(o)), h('span', { class: 'muted small' }, when(o.at)))), pend.length > 30 ? h('p', { class: 'muted small' }, `…and ${pend.length - 30} more`) : null))
        : h('p', { class: 'muted' }, 'Nothing is waiting. Everything is saved on the server.'),
      conf ? h('p', {}, `${conf} note${conf > 1 ? 's were' : ' was'} changed on two devices. Look for "Conflict copy" in your notes.`) : null,
      fails.length ? h('div', {}, h('p', {}, `${fails.length} change${fails.length > 1 ? 's' : ''} the server could not accept (this device now shows the server's version):`),
        h('div', { class: 'list' }, ...fails.map((o) => h('div', { class: 'row-link' }, h('span', { class: 'grow ell' }, label(o)), h('span', { class: 'muted small ell' }, o.error))))) : null,
      (conf || fails.length) ? h('div', { class: 'row gap' }, h('button', { class: 'btn sm', onClick: () => engine.clearFailed() }, 'Dismiss')) : null);
  };
  const run = (fn) => async () => { msg.textContent = ''; try { await fn(); } catch (e) { msg.textContent = e.message; } draw(); };
  const syncNow = run(async () => {
    if (navigator.onLine === false) throw new Error('You are offline. It will upload by itself when you are back online.');
    await engine.flush();
    msg.textContent = engine.pending() ? 'Some changes could not be uploaded yet. It will try again by itself.' : 'Everything is uploaded.';
  });
  const exportNow = run(async () => {
    const data = await engine.exportData();
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `tutorial-tracker-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    msg.textContent = 'Your data was downloaded.';
  });
  const resetNow = run(async () => {
    const n = engine.pending();
    let keep = true;
    if (n > 0) { if (!confirm(`${n} change${n > 1 ? 's are' : ' is'} still waiting to upload. Resetting this device's copy will DISCARD them. Continue?`)) return; keep = false; }
    else if (!confirm("Download a fresh copy of your data from the server to this device?")) return;
    if (navigator.onLine === false) throw new Error('You are offline. Connect first, then reset.');
    await engine.resetDevice(keep);
    msg.textContent = 'This device now has a fresh copy.';
  });
  window.addEventListener('tt-outbox', draw);
  draw();
  return sec('Sync and offline',
    h('p', { class: 'muted' }, 'Changes made without a connection are saved on this device and upload by themselves when you are back online.'),
    body,
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', onClick: syncNow }, 'Sync now'), h('button', { class: 'btn', onClick: exportNow }, 'Export my data (JSON)'), h('button', { class: 'btn', onClick: resetNow }, "Reset this device's copy")),
    msg);
}
