// Task drawer: manage one ticket without leaving the board or the timeline.
// Assignee (you or your AI assistant), dates, priority, labels, notes, subtasks, files, steps, hand-off brief.
import { h, toast, debounce, bar } from './dom.js';
import { api } from './api.js';
import { S, sprintName, STATUS_LABEL } from './state.js';
import { todayStr, fmtDate, addDaysStr, parse } from './dates.js';
import { avatar } from './ui.js';
import * as files from './files.js';

export const PRIORITY = ['None', 'Low', 'Medium', 'High'];
export const PRESET_LABELS = ['Bug', 'Feature', 'Docs', 'Review', 'Needs Claude', 'Claude done'];
const rid = () => Math.random().toString(36).slice(2, 10);
let current = null;

export const labelClass = (l) => 'lb lb-' + (['bug', 'feature', 'docs', 'review', 'needs claude', 'claude done'].indexOf(l.toLowerCase()) + 1);

/** Builds the paste-ready prompt for handing a ticket to an AI coding assistant. */
export function buildBrief(d, extras, member) {
  const t = d.ticket;
  const steps = d.steps.filter((s) => s.kind === 'step' || s.kind === 'verify');
  const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + ' …' : s);
  const lines = [
    `# Task ${t.id}: ${t.title}`,
    `Sprint: ${sprintName({ title: t.sprint.title })} (S${t.sprint.id})`,
    '',
    `You are helping me build my Next.js boilerplate project. Please do this ticket for me${member ? ` (assigned to ${member})` : ''}. Work through the steps in order, keep changes small and tell me what you did after each step.`,
    '',
    '## Steps',
    ...steps.flatMap((s, i) => [`${i + 1}. [${s.done ? 'x' : ' '}] ${s.kind === 'verify' ? '(verify) ' : ''}${s.title}`, ...(s.body ? [clip(s.body.trim(), 1200).split('\n').map((l) => '   ' + l).join('\n')] : [])]),
  ];
  if (t.note?.trim()) lines.push('', '## My notes', t.note.trim());
  if (extras.s.length) lines.push('', '## Subtasks', ...extras.s.map((x) => `- [${x.d ? 'x' : ' '}] ${x.t}`));
  if (extras.f.length) lines.push('', '## Files I attached (open them in the tracker if you need them)', ...extras.f.map((f) => `- ${f.n}`));
  if (extras.b) lines.push('', `## Blocked\n${extras.b}`);
  lines.push('', '## Definition of done', '- Every step above is finished and every "verify" check passes.', '- Reply with: files changed, commands you ran, and anything you were unsure about.', `- When finished, say "${t.id} ready for review" so I can check it and tick it off.`);
  return lines.join('\n');
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = h('textarea', { style: { position: 'fixed', opacity: 0 }, value: text });
  document.body.append(ta); ta.select();
  const ok = document.execCommand?.('copy');
  ta.remove();
  return !!ok;
}

export function closeDrawer() { current?.close(); }

export async function openDrawer(ticketId, { onChange } = {}) {
  closeDrawer();
  const sec = (title, ...kids) => h('section', { class: 'dr-sec' }, h('h3', {}, title), ...kids);
  let d, extras, schedule = null, plan = null;
  const root = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Task ' + ticketId, tabindex: '-1' }, h('div', { class: 'dr-loading' }, 'Loading…'));
  const back = h('div', { class: 'dr-back' });
  try { const u = new URL(location.href); u.searchParams.set('t', ticketId); history.replaceState(null, '', u); } catch {}
  let closed = false;
  const prevFocus = document.activeElement;
  const close = () => {
    if (closed) return;
    closed = true;
    try { const u = new URL(location.href); if (u.searchParams.get('t') === ticketId) { u.searchParams.delete('t'); history.replaceState(null, '', u); } } catch {}
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('paste', onPaste, true);
    root.classList.remove('in'); back.classList.remove('in');
    setTimeout(() => { root.remove(); back.remove(); document.body.classList.remove('drawer-open'); }, 200);
    if (current?.id === ticketId) current = null;
    try { prevFocus?.focus?.(); } catch {}
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.lightbox')) { e.stopPropagation(); close(); } };
  const onPaste = (e) => {
    const f = [...(e.clipboardData?.files || [])];
    if (f.length && root.contains(document.activeElement || root)) { e.preventDefault(); addFiles(f); }
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('paste', onPaste, true);
  back.addEventListener('click', close);
  document.body.append(back, root);
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => { root.classList.add('in'); back.classList.add('in'); root.focus(); });
  current = { id: ticketId, close };

  const notify = (what) => { try { onChange?.(what); } catch {} };
  const hosted = !!S.hosted;

  try {
    [d, extras] = await Promise.all([api.ticket(ticketId), api.ticketExtras(ticketId)]);
    const p = await api.plan(todayStr()).catch(() => null);
    plan = p?.plan || null; schedule = p?.schedule || null;
  } catch (e) { root.replaceChildren(h('div', { class: 'dr-loading' }, e.message)); return; }

  const saveExtras = debounce(async () => {
    try { extras = { ...extras, ...(await api.saveExtras(ticketId, { p: extras.p, l: extras.l, s: extras.s, b: extras.b, c: extras.c, ...(hosted ? { f: extras.f } : {}) })), ...(hosted ? {} : {}) }; notify('extras'); } catch (e) { toast(e.message, 'err'); }
  }, 350);
  const touch = () => { saveExtras(); };

  const entry = () => schedule?.sprints.flatMap((r) => r.schedule).find((x) => x.id === ticketId) || null;
  const team = () => schedule?.team || [];

  // ---- pieces that repaint themselves
  const status = h('span', { class: 'st' });
  const prog = h('div', { class: 'dr-prog' });
  const paintHead = () => {
    const t = d.ticket;
    status.className = 'st ' + t.status; status.textContent = STATUS_LABEL[t.status] || t.status;
    prog.replaceChildren(bar(t.done, t.total), h('span', { class: 'muted small' }, `${t.done}/${t.total} steps`));
  };

  // assignee
  const whoBox = h('div', { class: 'dr-who' });
  const paintWho = () => {
    const e = entry();
    if (!plan) return whoBox.replaceChildren(h('p', { class: 'muted small' }, 'Create a timeline first to split the work between you and your AI assistant. '), h('a', { class: 'btn sm', href: '#/timeline', onClick: close }, 'Create timeline'));
    const m = team();
    const hasAi = m.some((x) => x.kind === 'ai');
    const cur = e?.manual?.member ? e.member : '';
    const chip = (id, label, node) => h('button', { type: 'button', class: 'who-chip' + (cur === id ? ' on' : ''), disabled: !e || e.history, onClick: () => assign(id) }, node, label);
    whoBox.replaceChildren(
      h('div', { class: 'who-row' }, chip('', 'Auto', h('span', { class: 'who-auto' }, '⚖')), ...m.map((x) => chip(x.id, x.name, x.kind === 'ai' ? h('span', { class: 'avatar ai', style: { '--mc': x.color } }, '✦') : avatar(x)))),
      e && !e.manual?.member ? h('p', { class: 'muted small' }, `Auto split currently gives it to ${m.find((x) => x.id === e.member)?.name || '—'}.`) : null,
      hasAi ? null : h('button', { class: 'btn sm', type: 'button', onClick: addClaude }, '✦ Add Claude (AI assistant) to the plan'));
  };
  const reschedule = (res) => { schedule = res.schedule; plan = res.plan || plan; paintWho(); paintDates(); notify('plan'); };
  const assign = async (member) => { try { reschedule(await api.planManual({ ticketId, member: member || null }, todayStr())); } catch (e) { toast(e.message, 'err'); } };
  const addClaude = async () => {
    try {
      const next = { ...plan, team: [...(plan.team?.length ? plan.team : [{ name: 'You' }]), { name: 'Claude', kind: 'ai', color: '#b794f6' }] };
      reschedule(await api.planSave(next, todayStr()));
      toast('Claude added to your team. Assign tickets to it here, on the board or on the timeline.');
    } catch (e) { toast(e.message, 'err'); }
  };

  // dates
  const dates = h('div', { class: 'dr-dates' });
  const paintDates = () => {
    const e = entry();
    if (!e) return dates.replaceChildren(h('span', { class: 'muted small' }, plan ? 'This ticket is not part of the plan (deferred or reference).' : 'No timeline yet.'));
    if (e.history) return dates.replaceChildren(h('span', { class: 'muted small' }, e.assumed ? 'Finished earlier (no exact date recorded).' : `Finished ${fmtDate(e.due, true)}.`));
    const move = async (s, due) => { try { reschedule(await api.planManual({ ticketId, start: s, due }, todayStr())); } catch (er) { toast(er.message, 'err'); } };
    const start = h('input', { type: 'date', value: e.start, onChange: (ev) => ev.target.value && move(ev.target.value, e.due < ev.target.value ? ev.target.value : e.due) });
    const due = h('input', { type: 'date', value: e.due, onChange: (ev) => ev.target.value && move(e.start > ev.target.value ? ev.target.value : e.start, ev.target.value) });
    const shift = (n) => move(addDaysStr(e.start, n), addDaysStr(e.due, n));
    dates.replaceChildren(
      h('label', {}, h('span', { class: 'muted small' }, 'Start'), start), h('label', {}, h('span', { class: 'muted small' }, 'Due'), due),
      h('div', { class: 'row gap' }, h('button', { class: 'btn sm', type: 'button', onClick: () => shift(-1) }, '−1 day'), h('button', { class: 'btn sm', type: 'button', onClick: () => shift(1) }, '+1 day'), h('button', { class: 'btn sm', type: 'button', onClick: () => shift(7) }, '+1 week'),
        e.manual?.due || e.manual?.member ? h('button', { class: 'btn sm', type: 'button', onClick: async () => { try { reschedule(await api.planManual({ ticketId, clear: true }, todayStr())); toast('Back to the automatic plan'); } catch (er) { toast(er.message, 'err'); } } }, '↺ Auto') : null));
  };

  // priority + labels
  const prio = h('div', { class: 'seg' });
  const paintPrio = () => prio.replaceChildren(...PRIORITY.map((n, i) => h('button', { type: 'button', class: 'prio-' + i + (extras.p === i ? ' on' : ''), onClick: () => { extras.p = i; paintPrio(); touch(); } }, i ? '⚑ ' + n : n)));
  const lblBox = h('div', { class: 'dr-labels' });
  const paintLabels = () => {
    const has = (l) => extras.l.some((x) => x.toLowerCase() === l.toLowerCase());
    const toggle = (l) => { extras.l = has(l) ? extras.l.filter((x) => x.toLowerCase() !== l.toLowerCase()) : [...extras.l, l].slice(0, 8); paintLabels(); touch(); };
    const custom = h('input', { class: 'text-input', placeholder: 'New label…', maxlength: 20, onKeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { toggle(e.target.value.trim()); } } });
    lblBox.replaceChildren(
      h('div', { class: 'row wrap gap6' }, ...PRESET_LABELS.map((l) => h('button', { type: 'button', class: labelClass(l) + (has(l) ? ' on' : ''), onClick: () => toggle(l) }, l)), ...extras.l.filter((l) => !PRESET_LABELS.some((p) => p.toLowerCase() === l.toLowerCase())).map((l) => h('button', { type: 'button', class: 'lb on', title: 'Remove', onClick: () => toggle(l) }, l + ' ×'))),
      custom);
  };

  // blocked reason
  const blocked = h('div', { class: 'dr-blocked' });
  const paintBlocked = () => {
    const on = d.ticket.status === 'blocked';
    blocked.hidden = !on && !extras.b;
    blocked.replaceChildren(h('label', {}, h('span', { class: 'muted small' }, 'Why is it blocked?'), h('input', { class: 'text-input', value: extras.b, maxlength: 200, placeholder: 'e.g. waiting for the API key', onInput: (e) => { extras.b = e.target.value; touch(); } })));
  };

  // subtasks
  const subBox = h('div', { class: 'dr-subs' });
  const paintSubs = () => {
    const n = extras.s.length, dn = extras.s.filter((x) => x.d).length;
    const mv = (i, k) => { const a = extras.s; [a[i], a[i + k]] = [a[i + k], a[i]]; paintSubs(); touch(); };
    const add = h('input', { class: 'text-input', placeholder: 'Add a subtask and press Enter…', maxlength: 200, onKeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { extras.s.push({ i: rid(), t: e.target.value.trim(), d: 0 }); paintSubs(); touch(); subBox.querySelector('input.text-input:last-child')?.focus(); } } });
    subBox.replaceChildren(
      n ? h('div', { class: 'dr-subprog' }, bar(dn, n), h('span', { class: 'muted small' }, `${dn}/${n}`)) : null,
      h('ul', { class: 'subs' }, ...extras.s.map((x, i) => h('li', { class: x.d ? 'done' : '' },
        h('input', { type: 'checkbox', checked: !!x.d, 'aria-label': 'Done', onChange: (e) => { x.d = e.target.checked ? 1 : 0; paintSubs(); touch(); } }),
        h('input', { class: 'sub-t', value: x.t, maxlength: 200, onInput: (e) => { x.t = e.target.value; touch(); }, onBlur: (e) => { if (!e.target.value.trim()) { extras.s.splice(i, 1); paintSubs(); touch(); } } }),
        h('span', { class: 'sub-act' }, h('button', { type: 'button', title: 'Up', disabled: i === 0, onClick: () => mv(i, -1) }, '↑'), h('button', { type: 'button', title: 'Down', disabled: i === n - 1, onClick: () => mv(i, 1) }, '↓'), h('button', { type: 'button', title: 'Delete', onClick: () => { extras.s.splice(i, 1); paintSubs(); touch(); } }, '✕'))))),
      add);
  };

  // files
  const filesBox = h('div', { class: 'dr-files' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onChange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });
  let busy = 0;
  async function addFiles(list) {
    for (const f of list) {
      if (extras.f.length >= 30) { toast('A ticket can hold up to 30 files.', 'err'); break; }
      busy++; paintFiles();
      try {
        const r = await files.upload(ticketId, f, hosted);
        if (r.extras) extras = { ...extras, f: r.extras.f };
        else { extras.f = [...extras.f, r.file]; await api.saveExtras(ticketId, { p: extras.p, l: extras.l, s: extras.s, b: extras.b, c: extras.c, f: extras.f }); }
        notify('extras');
      } catch (e) { toast(e.message, 'err'); }
      busy--; paintFiles();
    }
  }
  const lightbox = async (f) => {
    const url = await files.urlFor(f).catch((e) => (toast(e.message, 'err'), null));
    if (!url) return;
    const lb = h('div', { class: 'lightbox', onClick: () => lb.remove() }, h('img', { src: url, alt: f.n }), h('div', { class: 'lb-cap' }, f.n, ' · ', h('a', { href: url, target: '_blank', rel: 'noopener', onClick: (e) => e.stopPropagation() }, 'Open original')));
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); lb.remove(); document.removeEventListener('keydown', esc, true); } };
    document.addEventListener('keydown', esc, true);
    document.body.append(lb);
  };
  const remove = async (f) => {
    if (!confirm(`Delete "${f.n}"?`)) return;
    try {
      if (hosted) { await files.removeObject(f); extras.f = extras.f.filter((x) => x.i !== f.i); await api.saveExtras(ticketId, { p: extras.p, l: extras.l, s: extras.s, b: extras.b, c: extras.c, f: extras.f }); }
      else extras = { ...extras, f: (await api.deleteFile(ticketId, f.i)).extras.f };
      paintFiles(); notify('extras');
    } catch (e) { toast(e.message, 'err'); }
  };
  const paintFiles = () => {
    const zone = h('div', { class: 'dropzone', tabindex: 0, role: 'button', 'aria-label': 'Add files', onClick: () => fileInput.click(), onKeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.click()),
      onDragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, onDragleave: () => zone.classList.remove('over'), onDrop: (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...e.dataTransfer.files]); } },
      h('strong', {}, busy ? 'Uploading…' : 'Drop files, paste a screenshot, or click'), h('span', { class: 'muted small' }, 'Images are shrunk automatically. Up to 25 MB each.'));
    const tiles = extras.f.map((f) => {
      const t = h('div', { class: 'file' });
      if (files.isImage(f.m)) {
        const img = h('img', { alt: f.n, loading: 'lazy' });
        files.urlFor(f).then((u) => (img.src = u)).catch(() => (img.alt = 'unavailable'));
        t.append(h('button', { type: 'button', class: 'thumb', title: f.n, onClick: () => lightbox(f) }, img));
      } else {
        t.append(h('button', { type: 'button', class: 'thumb doc', title: 'Download', onClick: async () => { const u = await files.urlFor(f).catch(() => null); if (u) { const a = h('a', { href: u, download: f.n, target: '_blank', rel: 'noopener' }); document.body.append(a); a.click(); a.remove(); } } }, h('span', {}, files.icon(f.m, f.n))));
      }
      t.append(h('div', { class: 'f-meta' }, h('span', { class: 'f-name', title: f.n }, f.n), h('span', { class: 'muted small' }, files.fmtSize(f.z))), h('button', { type: 'button', class: 'f-del', title: 'Delete', 'aria-label': 'Delete ' + f.n, onClick: () => remove(f) }, '✕'));
      return t;
    });
    filesBox.replaceChildren(zone, tiles.length ? h('div', { class: 'file-grid' }, ...tiles) : null, fileInput);
  };

  // notes
  const noteTa = h('textarea', { class: 'note-ta', rows: 4, value: d.ticket.note || '', placeholder: 'Your notes for this ticket (Markdown)…', 'aria-label': 'Notes' });
  const noteState = h('span', { class: 'muted small' });
  const saveNote = debounce(async () => { noteState.textContent = 'Saving…'; try { await api.ticketNote(ticketId, noteTa.value); d.ticket.note = noteTa.value; noteState.textContent = 'Saved'; notify('note'); } catch (e) { noteState.textContent = ''; toast(e.message, 'err'); } }, 500);
  noteTa.addEventListener('input', () => { noteState.textContent = 'Typing…'; saveNote(); });
  noteTa.addEventListener('blur', () => saveNote.flush());

  // comments
  const cBox = h('div', { class: 'dr-comments' });
  const cTa = h('textarea', { class: 'note-ta', rows: 2, placeholder: 'Write a comment, or paste what Claude answered…', 'aria-label': 'New comment' });
  let cWho = 'me';
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(); };
  const paintComments = () => {
    const list = extras.c || [];
    cBox.replaceChildren(
      list.length ? h('ul', { class: 'cm-list' }, ...list.map((c) => h('li', { class: 'cm ' + c.w },
        h('div', { class: 'cm-h' }, h('b', {}, c.w === 'ai' ? '✦ Claude' : 'You'), h('span', { class: 'muted small' }, ago(c.at)), h('span', { class: 'sp' }),
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Delete comment', onClick: async () => { try { extras.c = list.filter((x) => x.i !== c.i); await persistC(); } catch (e) { toast(e.message, 'err'); } } }, '✕')),
        h('p', { class: 'cm-t' }, c.t)))) : h('p', { class: 'muted small' }, 'No comments yet. Use them as a log: what you tried, what Claude produced, what to check next.'),
      cTa,
      h('div', { class: 'row gap' },
        h('select', { class: 'sel', 'aria-label': 'Comment as', onChange: (e) => { cWho = e.target.value; } }, h('option', { value: 'me', selected: cWho === 'me' }, 'As me'), h('option', { value: 'ai', selected: cWho === 'ai' }, 'As Claude')),
        h('button', { class: 'btn sm primary', type: 'button', onClick: async () => {
          const t = cTa.value.trim(); if (!t) return;
          try { extras.c = [...(extras.c || []), { i: Math.random().toString(36).slice(2, 10), w: cWho, t, at: Date.now() }]; await persistC(); cTa.value = ''; } catch (e) { toast(e.message, 'err'); }
        } }, 'Add comment')));
  };
  const persistC = async () => {
    const r = await api.saveExtras(ticketId, { p: extras.p, l: extras.l, s: extras.s, b: extras.b, c: extras.c, ...(hosted ? { f: extras.f } : {}) });
    extras.c = r.c || []; paintComments(); notify('extras');
  };

  // steps
  const stepsBox = h('ul', { class: 'dr-steps' });
  const paintSteps = () => stepsBox.replaceChildren(...d.steps.filter((s) => s.kind === 'step' || s.kind === 'verify').map((s) => h('li', { class: s.done ? 'done' : '' },
    h('input', { type: 'checkbox', checked: !!s.done, 'aria-label': s.title, onChange: async (e) => {
      try { const r = await api.done(s.id, e.target.checked); s.done = e.target.checked ? 1 : 0; d.ticket.done = d.steps.filter((x) => (x.kind === 'step' || x.kind === 'verify') && x.done).length; d.ticket.status = r?.ticket?.status || r?.status || (d.ticket.done >= d.ticket.total ? 'done' : d.ticket.done ? 'doing' : 'todo'); paintHead(); paintSteps(); notify('steps'); } catch (er) { e.target.checked = !e.target.checked; toast(er.message, 'err'); }
    } }), h('span', {}, s.title))));

  // status override
  const statusSel = h('select', { class: 'sel', 'aria-label': 'Status', onChange: async (e) => {
    try { const r = await api.ticketStatus(ticketId, e.target.value || null); d.ticket.status = r?.status || r?.ticket?.status || d.ticket.status; paintHead(); paintBlocked(); notify('status'); if (d.ticket.status === 'blocked') toast('Add a short reason below.'); } catch (er) { toast(er.message, 'err'); }
  } }, h('option', { value: '' }, 'Auto (from steps)'), ...[['pending', 'To do (parked)'], ['doing', 'In progress'], ['blocked', 'Blocked'], ['test', 'Test & fixes']].map(([k, l]) => h('option', { value: k, selected: d.ticket.override === (k === 'pending' ? 'todo' : k) }, l)));

  const brief = async () => {
    const e = entry(); const m = team().find((x) => x.id === e?.member);
    const txt = buildBrief(d, extras, m?.name);
    toast((await copy(txt)) ? `Brief copied (${txt.length.toLocaleString()} characters). Paste it into Claude.` : 'Could not copy. Select and copy manually.', '');
  };

  root.replaceChildren(
    h('header', { class: 'dr-head' },
      h('div', { class: 'dr-top' }, h('span', { class: 'kicker' }, `S${d.ticket.sprint.id} · ${d.ticket.id}`), status, h('span', { class: 'sp' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onClick: close }, '✕')),
      h('h2', {}, d.ticket.title), prog,
      h('div', { class: 'row gap wrap' }, statusSel, h('button', { class: 'btn sm', type: 'button', onClick: brief, title: 'Copies a ready-to-paste prompt with the steps, your notes and subtasks' }, '✦ Brief for Claude'), h('button', { class: 'btn sm', type: 'button', title: 'Copy a link that opens this task', onClick: async () => { const u = new URL(location.href); u.hash = ''; u.search = ''; u.searchParams.set('t', ticketId); toast((await copy(u.toString())) ? 'Link copied.' : 'Could not copy the link.', ''); } }, '🔗 Copy link'), h('a', { class: 'btn sm', href: `#/t/${encodeURIComponent(ticketId)}`, onClick: close }, 'Open full page ↗'))),
    h('div', { class: 'dr-body' },
      blocked,
      sec('Assigned to', whoBox),
      sec('Dates', dates),
      sec('Priority & labels', prio, lblBox),
      sec('Subtasks', subBox),
      sec('Files & images', filesBox),
      sec('Notes', noteTa, noteState),
      sec('Comments', cBox),
      sec('Steps', stepsBox)));
  paintHead(); paintWho(); paintDates(); paintPrio(); paintLabels(); paintBlocked(); paintSubs(); paintFiles(); paintComments(); paintSteps();
}
