import { h, toast, ago } from './dom.js';
import { api } from './api.js';
import { S } from './state.js';
import { refreshOverview } from './sidebar.js';
import { getLog, clearLog } from './perf.js';

const KEYS = [['← →', 'Previous / next slide'], ['Space', 'Mark slide done'], ['[  ]', 'Previous / next ticket'], ['E', 'Edit slide'], ['N', 'Toggle notes'], ['Ctrl K', 'Search'], ['Esc', 'Close dialog']];

export async function settingsView(root) {
  S.keys = {};
  S.activeTicket = null;
  document.title = 'Settings — Tutorial Tracker';
  let info;
  try { info = await api.info(); } catch (e) { return root.replaceChildren(h('p', { class: 'pad' }, e.message)); }
  const hosted = !!S.hosted;

  const report = h('div', { class: 'report' });
  const showReport = (r) => {
    report.replaceChildren(h('div', { class: 'banner ok' },
      `Imported ${r.sprints} file${r.sprints === 1 ? '' : 's'}: `,
      `${r.steps.added} new, ${r.steps.updated} updated, ${r.steps.flagged} edited slides with upstream changes, `,
      `${r.steps.orphaned + r.steps.removed} removed upstream.`));
  };
  const doImport = async (files) => {
    try { const { report: r } = await api.import(files); showReport(r); await refreshOverview(); toast('Import finished'); }
    catch (e) { report.replaceChildren(h('div', { class: 'banner bad' }, e.message)); }
  };
  const file = h('input', { type: 'file', accept: '.md,text/markdown', multiple: true, hidden: true, onChange: async (e) => {
    const files = await Promise.all([...e.target.files].map(async (f) => ({ name: f.name, text: await f.text() })));
    e.target.value = '';
    if (files.length) doImport(files);
  } });

  const exp = h('div', { class: 'report' });
  const perfBox = h('div', { class: 'report' });
  const drawPerf = () => {
    const l = getLog();
    perfBox.replaceChildren(l.length
      ? h('div', { class: 'list' }, l.map((e) => h('div', { class: 'row-link' }, h('span', { class: 'chip' }, e.kind), h('span', { class: 'grow ell' }, [e.route, e.detail].filter(Boolean).join(' · ')), h('span', { class: 'muted small' }, e.ms + ' ms · ' + new Date(e.t).toLocaleTimeString()))))
      : h('p', { class: 'muted' }, 'No slow moments recorded. 🎉'));
  };
  drawPerf();
  const sec = (title, ...kids) => h('section', { class: 'card wide' }, h('h3', {}, title), ...kids);

  const localSecs = () => [
    sec('Import tutorial files',
      h('p', { class: 'muted' }, 'Safe to repeat. Slides you never edited follow the new text; slides you edited keep your version and get an “upstream changed” flag to review. Progress and notes are never touched. A backup is made first.'),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary', onClick: () => doImport() }, 'Re-import from content folder'),
        h('button', { class: 'btn', onClick: () => file.click() }, 'Choose .md files…'), file),
      h('p', { class: 'muted small' }, 'Content folder: ', h('code', {}, info.contentDir), info.lastImport ? ` · last import ${ago(info.lastImport.replace('T', ' ').slice(0, 19))}` : ''),
      report),
    sec('Export to markdown',
      h('p', { class: 'muted' }, 'Writes your current text (with your edits) back to clean .md files, identical in layout to the originals.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', onClick: async () => { try { const r = await api.exportAll(); exp.replaceChildren(h('div', { class: 'banner ok' }, `Wrote ${r.files.length} files to `, h('code', {}, r.dir))); } catch (e) { toast(e.message, 'err'); } } }, 'Export all to folder'),
        info.sprints.map((s) => h('a', { class: 'btn sm', href: `/api/export/${encodeURIComponent(s.id)}`, download: s.file, title: s.title }, '↓ S' + s.id))),
      exp),
    sec('Data',
      h('p', { class: 'muted small' }, 'Database: ', h('code', {}, info.dbPath)),
      h('p', { class: 'muted small' }, `Automatic backups (last ${info.backups.length}, taken at each start and before each import) are in the “backups” folder next to it.`),
      info.backups.length ? h('p', { class: 'muted small' }, info.backups.join(' · ')) : null,
      h('p', { class: 'muted small' }, `Version ${info.version} · this page was built from ${__APP_VERSION__} (${__APP_BUILD__})${info.node ? ' · Node ' + info.node : ''}`))
  ];
  root.replaceChildren(h('div', { class: 'dash narrow' },
    h('h1', { class: 'page-title' }, 'Settings'),
    hosted ? (await import('./account.js')).accountCards(sec) : localSecs(),
    sec('Performance log',
      h('p', { class: 'muted' }, 'Stays on this computer. If something freezes (for example while copying code), the moment is noted here so we can see what it was.'),
      perfBox,
      h('div', { class: 'row gap' }, h('button', { class: 'btn sm', onClick: () => { clearLog(); drawPerf(); } }, 'Clear log'))),
    sec('Keyboard shortcuts', h('div', { class: 'keys' }, KEYS.map(([k, d]) => h('div', {}, h('kbd', {}, k), h('span', {}, d)))))));
}
