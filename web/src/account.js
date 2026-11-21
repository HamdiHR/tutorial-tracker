// Settings cards for the hosted version: account, starting point, people (owner only).
import { h, toast } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { signOut, changePassword } from './auth.js';
import { refreshOverview } from './sidebar.js';

export function accountCards(sec) {
  const me = S.me || {};
  const start = me.start?.mode === 'point' ? `Started at ${me.start.ticket}${me.start.markedPrevious ? ', earlier work marked done' : ''}` : 'Started from the beginning';
  const cards = [
    sec('Account',
      h('p', {}, h('strong', {}, me.email || ''), ' ', h('span', { class: 'chip' }, me.role || 'member')),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', onClick: signOut }, 'Sign out'))),
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
