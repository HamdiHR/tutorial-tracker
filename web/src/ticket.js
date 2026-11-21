import { todayStr, fmtDate } from './dates.js';
import { h, esc, toast, bar, debounce } from './dom.js';
import { api } from './api.js';
import { S, ls, sprintName, STATUS_LABEL } from './state.js';
import { renderMarkdown, bindCopy, ensureMd, highlightIn } from './md.js';
import { openEditor, openHistory, openUpstream } from './editor.js';
import { refreshOverview, patchTicket } from './sidebar.js';
import { ticketComplete } from './fx.js';
import { floatText, enter } from './motion.js';
import { pct } from './dom.js';

const checkable = (s) => s.kind === 'step' || s.kind === 'verify';

function noteBox(label, value, save) {
  let editing = true;
  const ta = h('textarea', { class: 'note-ta', rows: 5, value, placeholder: 'Markdown supported…', spellcheck: true, 'aria-label': label });
  const view = h('div', { class: 'markdown note-view' });
  const state = h('span', { class: 'muted small' });
  const run = debounce(async () => {
    state.textContent = 'Saving…';
    try { await save(ta.value); state.textContent = 'Saved'; } catch (e) { state.textContent = ''; toast(e.message, 'err'); }
  }, 450);
  ta.addEventListener('input', () => { state.textContent = 'Typing…'; run(); });
  ta.addEventListener('blur', () => run.flush());
  const toggle = h('button', { class: 'link', onClick: () => {
    editing = !editing;
    if (!editing) { view.innerHTML = ta.value.trim() ? renderMarkdown(ta.value) : '<p class="muted">Nothing yet.</p>'; highlightIn(view); run.flush(); }
    ta.hidden = !editing; view.hidden = editing; toggle.textContent = editing ? 'Preview' : 'Edit';
  } }, 'Preview');
  view.hidden = true;
  bindCopy(view);
  return h('div', { class: 'note' }, h('div', { class: 'note-head' }, h('strong', {}, label), h('span', { class: 'grow' }), state, toggle), ta, view);
}

export async function ticketView(root, id, stepParam) {
  root.replaceChildren(h('p', { class: 'muted pad' }, 'Loading…'));
  let d;
  try { [d] = await Promise.all([api.ticket(id), ensureMd(), refreshOverview().catch(() => {})]); } catch (e) { return root.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Not found'), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to dashboard'))); }

  S.activeTicket = id;
  const visible = () => d.steps.filter((s) => !(s.kind === 'intro' && !s.body.trim()));
  let idx = 0;
  {
    const steps = visible();
    const byParam = stepParam ? steps.findIndex((s) => String(s.id) === String(stepParam)) : -1;
    const cur = S.overview?.current;
    const byResume = !stepParam && cur?.ticketId === id && cur.stepId ? steps.findIndex((s) => s.id === cur.stepId) : -1;
    if (byParam >= 0) idx = byParam;
    else if (byResume >= 0) idx = byResume;
    else if (steps.some((s) => s.done)) { const u = steps.findIndex((s) => checkable(s) && !s.done); idx = u >= 0 ? u : 0; }
  }
  let resumeDirty = false;
  const sendResume = () => { resumeDirty = false; const s = visible()[idx]; if (s) api.resume(id, s.id).catch(() => {}); };
  const saveResume = () => { resumeDirty = true; slowResume(); };
  const slowResume = debounce(sendResume, 300);
  const flushResume = () => { if (!resumeDirty) return; resumeDirty = false; slowResume.cancel(); const s = visible()[idx]; if (s) api.resumeKeepalive(id, s.id); };
  window.addEventListener('pagehide', flushResume);
  window.addEventListener('hashchange', function once() { flushResume(); window.removeEventListener('hashchange', once); window.removeEventListener('pagehide', flushResume); });

  let shownPct = 0; // where the header progress bar animates from
  let justDone = null; // step id that was just ticked (pop animation)

  async function reload(keepId, anim = null) {
    d = await api.ticket(id);
    if (keepId) { const i = visible().findIndex((s) => s.id === keepId); if (i >= 0) idx = i; }
    idx = Math.min(idx, visible().length - 1);
    draw(anim);
    refreshOverview().catch(() => {});
  }

  function go(i, scroll = true) {
    const steps = visible();
    if (i < 0) { if (d.prev) location.hash = `#/t/${encodeURIComponent(d.prev)}/last`; return; }
    if (i >= steps.length) { if (d.next) location.hash = `#/t/${encodeURIComponent(d.next)}`; return; }
    const anim = i > idx ? 'next' : 'prev';
    idx = i;
    history.replaceState(null, '', `#/t/${encodeURIComponent(id)}/${steps[i].id}`);
    draw(anim);
    if (scroll) window.scrollTo({ top: 0 });
    saveResume();
  }

  async function toggleDone(step, advance = false) {
    const before = d.ticket.status;
    const anchor = root.querySelector('.slide-nav .btn.primary');
    try {
      const r = await api.done(step.id, step.done ? 0 : 1);
      step.done = step.done ? 0 : 1;
      if (r.ticket) { Object.assign(d.ticket, { status: r.ticket.status, override: r.ticket.override, done: r.ticket.done, total: r.ticket.total }); patchTicket(r.ticket, r.player); }
      if (step.done) { justDone = step.id; floatText(root.querySelector('.toggle-done') || anchor, '+10 XP', 'xp'); }
      let anim = null;
      if (advance && step.done) {
        const steps = visible();
        const ni = idx + 1;
        if (ni < steps.length) { idx = ni; anim = 'next'; history.replaceState(null, '', `#/t/${encodeURIComponent(id)}/${steps[ni].id}`); window.scrollTo({ top: 0 }); saveResume(); }
      }
      draw(anim);
      if (before !== 'done' && d.ticket.status === 'done') ticketComplete(d.ticket.title, root.querySelector('.t-meta .st'));
    } catch (e) { toast(e.message, 'err'); }
  }

  async function setStatus(value, step) {
    if (value === 'todo' && !confirm('Reset this ticket? All of its steps will be unticked (you can undo right after).')) { await reload(step.id); return; }
    const before = d.ticket.status;
    try {
      const r = await api.ticketStatus(id, value || null);
      await reload(step.id);
      if (r.undo && r.steps) toast(`${r.steps} step${r.steps === 1 ? '' : 's'} ${value === 'done' ? 'ticked' : 'cleared'}`, '', { label: 'Undo', fn: async () => { try { await api.bulkUndo(r.undo); await reload(step.id); toast('Undone'); } catch (e) { toast(e.message, 'err'); } } });
      if (before !== 'done' && d.ticket.status === 'done') ticketComplete(d.ticket.title, root.querySelector('.t-meta .st'));
    } catch (err) { toast(err.message, 'err'); await reload(step.id); }
  }

  function planChips(t) {
    const pl = d.plan;
    const pt = pl?.ticket;
    if (!pt || t.deferred) return null;
    const late = t.status !== 'done' && pt.due < todayStr();
    const who = pl.team.find((m) => m.id === pt.member);
    const owner = pl.team.length > 1
      ? h('select', { class: 'sel owner', 'aria-label': 'Owner', style: { '--mc': who?.color }, onChange: async (e) => {
          try { await api.planManual({ ticketId: id, member: e.target.value || null }, todayStr()); await reload(); toast(e.target.value ? 'Reassigned' : 'Back to auto split'); } catch (x) { toast(x.message, 'err'); }
        } },
        pl.team.map((m) => h('option', { value: m.id, selected: m.id === pt.member }, m.name + (m.id === pt.member && pt.manual.member ? ' 📌' : ''))),
        pt.manual.member ? h('option', { value: '' }, '↺ Auto split') : null)
      : null;
    return h('span', { class: 'plan-chips' }, owner, h('a', { class: 'due-chip' + (late ? ' late' : ''), href: '#/timeline', title: 'Planned ' + fmtDate(pt.start) + ' → ' + fmtDate(pt.due) }, '🗓 due ' + fmtDate(pt.due)));
  }

  function draw(anim = null) {
    const steps = visible();
    const t = d.ticket;
    const ref = t.kind === 'ref';
    const step = steps[idx];
    S.keys = {};
    if (!step) { root.replaceChildren(h('p', { class: 'muted pad' }, 'This section has no content.')); return; }
    const isCheck = checkable(step);

    // header
    const statusSel = h('select', { class: 'sel', 'aria-label': 'Ticket status', onChange: (e) => setStatus(e.target.value, step) },
      h('option', { value: '' }, 'Status: automatic'),
      h('option', { value: 'doing' }, 'Mark in progress'),
      h('option', { value: 'test' }, 'Mark Test & fixes'),
      h('option', { value: 'blocked' }, 'Mark blocked'),
      h('option', { value: 'pending' }, 'Mark pending (keep steps)'),
      h('option', { value: 'done' }, '✓ Mark all steps done'),
      h('option', { value: 'todo' }, '↺ Reset all steps'));
    statusSel.value = t.override === 'todo' ? 'pending' : t.override || '';

    const head = h('header', { class: 't-head' },
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Sprint ' + t.sprint.id), ' · ', ref ? 'Reference' : t.id),
      h('h1', {}, t.title),
      ref ? null : h('div', { class: 't-meta' },
        h('span', { class: 'st ' + t.status }, STATUS_LABEL[t.status]),
        h('div', { class: 'grow-bar' }, bar(t.done, t.total, '', shownPct)),
        h('span', { class: 'muted small' }, `${t.done}/${t.total} steps`),
        t.deferred ? null : statusSel,
        planChips(t)),
    );

    // step rail
    const rail = h('nav', { class: 'rail', 'aria-label': 'Slides' }, steps.map((s, i) =>
      h('button', { class: 'pill' + (i === idx ? ' cur' : '') + (s.done ? ' done' : '') + (s.id === justDone ? ' pop' : '') + (s.edited ? ' edited' : '') + (s.kind === 'verify' ? ' verify' : ''), title: s.title, 'aria-current': i === idx ? 'step' : null, onClick: () => go(i) },
        s.kind === 'verify' ? '✓' : s.kind === 'intro' ? 'i' : String(i + (steps[0].kind === 'intro' ? 0 : 1)),
        s.note ? h('b', { class: 'pip' }) : null)));

    // slide
    const body = h('div', { class: 'markdown', html: renderMarkdown(step.body) });
    bindCopy(body);
    highlightIn(body);
    const badges = h('div', { class: 'badges' },
      step.edited ? h('span', { class: 'badge-chip edit', title: 'You edited this slide' }, 'edited') : null,
      step.drift ? h('a', { class: 'badge-chip drift', href: '#/drift', title: 'Verify-against-docs items' }, `🔍 ${step.drift}`) : null,
      step.orphan ? h('span', { class: 'badge-chip warn' }, 'removed upstream') : null);
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn sm', title: 'Edit (E)', onClick: () => openEditor(step, () => reload(step.id)) }, '✎ Edit'),
      h('button', { class: 'btn sm', title: 'History', onClick: () => openHistory(step, () => reload(step.id)) }, '↺ History'),
      h('button', { class: 'btn sm' + (S.notesOpen ? ' on' : ''), title: 'Notes (N)', onClick: () => { S.notesOpen = !S.notesOpen; ls('notesOpen', S.notesOpen ? '1' : '0'); draw(); } }, '✐ Notes' + (step.note || t.note ? ' •' : '')));
    const upstream = step.hasUpstream ? h('div', { class: 'banner' }, h('span', {}, '↯ The tutorial .md changed since you edited this slide.'), h('button', { class: 'btn sm', onClick: () => openUpstream(step, () => reload(step.id)) }, 'Review changes')) : null;

    const slide = h('article', { class: 'slide' + (anim ? ' anim-' + anim : '') },
      h('div', { class: 'slide-top' },
        h('div', { class: 'slide-title' }, h('span', { class: 'count' }, `${idx + 1} / ${steps.length}`), h('h2', {}, step.kind === 'intro' ? 'Overview' : step.title), badges),
        actions),
      upstream, body);

    // footer
    const last = idx === steps.length - 1;
    const prevLabel = idx === 0 ? (d.prev ? '← Previous ticket' : '←') : '← Back';
    const nextLabel = isCheck && !step.done ? (last ? '✓ Finish ticket' : '✓ Done & next →') : last ? (d.next ? 'Next ticket →' : 'End') : 'Next →';
    const foot = h('footer', { class: 'slide-nav' },
      h('button', { class: 'btn', disabled: idx === 0 && !d.prev, onClick: () => go(idx - 1) }, prevLabel),
      h('span', { class: 'grow' }),
      isCheck ? h('button', { class: 'btn' + (step.done ? ' done' : '') + (step.id === justDone ? ' pop' : '') + ' toggle-done', title: 'Toggle done (Space)', onClick: () => toggleDone(step) }, step.done ? '✓ Done' : '○ Mark done') : null,
      h('button', { class: 'btn primary', disabled: last && !d.next && !(isCheck && !step.done), onClick: () => {
        if (isCheck && !step.done) toggleDone(step, true).then(() => { if (last && d.next) location.hash = `#/t/${encodeURIComponent(d.next)}`; });
        else go(idx + 1);
      } }, nextLabel));

    // notes drawer
    const drawer = h('aside', { class: 'drawer' + (S.notesOpen ? ' open' : ''), 'aria-label': 'Notes' },
      h('div', { class: 'drawer-head' }, h('strong', {}, 'Notes'), h('span', { class: 'grow' }), h('button', { class: 'link', onClick: () => { S.notesOpen = false; ls('notesOpen', '0'); draw(); } }, 'Close')),
      noteBox('This slide', step.note, async (v) => { await api.stepNote(step.id, v); step.note = v; }),
      noteBox('Whole ticket', t.note, async (v) => { await api.ticketNote(id, v); t.note = v; }));

    root.replaceChildren(head, rail, slide, foot, drawer);
    shownPct = pct(t.done, t.total);
    justDone = null;
    root.querySelector('.pill.cur')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    root.classList.toggle('with-drawer', S.notesOpen);
    document.body.classList.toggle('drawer-open', S.notesOpen);

    S.keys = {
      ArrowLeft: () => go(idx - 1),
      ArrowRight: () => go(idx + 1),
      ' ': () => isCheck && toggleDone(step),
      e: () => openEditor(step, () => reload(step.id)),
      n: () => { S.notesOpen = !S.notesOpen; ls('notesOpen', S.notesOpen ? '1' : '0'); draw(); if (S.notesOpen) root.querySelector('.note-ta')?.focus(); },
      '[': () => d.prev && (location.hash = `#/t/${encodeURIComponent(d.prev)}`),
      ']': () => d.next && (location.hash = `#/t/${encodeURIComponent(d.next)}`),
    };
  }

  if (stepParam === 'last') { idx = visible().length - 1; }
  draw(stepParam === 'last' ? 'prev' : 'up');
  enter(root);
  history.replaceState(null, '', `#/t/${encodeURIComponent(id)}/${visible()[idx]?.id ?? ''}`);
  saveResume();
  renderTitle(d.ticket);
  void esc; void sprintName;
}

function renderTitle(t) { document.title = `${t.id} · ${t.title} — Tutorial Tracker`; }
