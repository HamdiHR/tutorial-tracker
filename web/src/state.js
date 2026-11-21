export function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

export const S = {
  overview: null,
  keys: {}, // per-view keyboard shortcuts: {ArrowLeft: fn, ...}
  notesOpen: ls('notesOpen') === '1' && !window.matchMedia('(max-width: 900px)').matches,
  openSprints: new Set(),
  activeTicket: null,
};

export const sprintLabel = (sp) => 'S' + sp.id;
export const sprintName = (sp) => sp.title.replace(/^Sprint\s+[\d.]+\s*[—–-]\s*/i, '');
export const shortId = (id) => id.replace(/^S[\d.]+-/, '');
export const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done', blocked: 'Blocked', test: 'Test & fixes', deferred: 'Deferred', ref: 'Reference' };
