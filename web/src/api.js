let onUnlocked = null;
let tokenProvider = null; // hosted mode: returns a fresh access token (or null)
let onUnauthorized = null;
export const setAuth = (provider, unauthorized) => { tokenProvider = provider; onUnauthorized = unauthorized; };
const authHeaders = async () => {
  const t = tokenProvider ? await tokenProvider() : null;
  return t ? { authorization: `Bearer ${t}` } : {};
};
/** Every mutation answers with the badges it just unlocked; one handler celebrates them. */
export const setUnlockHandler = (fn) => (onUnlocked = fn);

async function req(method, url, body) {
  const init = { method, headers: await authHeaders() };
  if (method !== 'GET') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let r;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error(tokenProvider ? 'Cannot reach the server. Check your connection.' : 'Cannot reach the local server. Is Tutorial Tracker still running?');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && onUnauthorized) { onUnauthorized(); throw new Error(data.error || 'Please sign in again.'); }
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  if (Array.isArray(data.unlocked) && data.unlocked.length) onUnlocked?.(data.unlocked);
  return data;
}
const id = encodeURIComponent;

export const api = {
  overview: () => req('GET', '/api/overview'),
  ticket: (t) => req('GET', `/api/tickets/${id(t)}`),
  extras: () => req('GET', '/api/extras'),
  ticketExtras: (t) => req('GET', `/api/tickets/${id(t)}/extras`),
  saveExtras: (t, body) => req('PUT', `/api/tickets/${id(t)}/extras`, body),
  uploadFile: (t, body) => req('POST', `/api/tickets/${id(t)}/files`, body),
  deleteFile: (t, f) => req('DELETE', `/api/tickets/${id(t)}/files/${f}`, {}),
  ticketNote: (t, note) => req('PUT', `/api/tickets/${id(t)}/note`, { note }),
  ticketStatus: (t, status) => req('PUT', `/api/tickets/${id(t)}/status`, { status }),
  done: (s, done) => req('POST', `/api/steps/${s}/done`, { done }),
  saveStep: (s, title, body) => req('PUT', `/api/steps/${s}`, { title, body }),
  stepNote: (s, note) => req('PUT', `/api/steps/${s}/note`, { note }),
  reset: (s) => req('POST', `/api/steps/${s}/reset`, {}),
  versions: (s) => req('GET', `/api/steps/${s}/versions`),
  upstream: (s, action) => req('POST', `/api/steps/${s}/upstream`, { action }),
  resume: (ticketId, stepId) => req('POST', '/api/resume', { ticketId, stepId }),
  resumeKeepalive: async (ticketId, stepId) => {
    const headers = { 'content-type': 'application/json', ...(await authHeaders().catch(() => ({}))) };
    return fetch('/api/resume', { method: 'POST', keepalive: true, headers, body: JSON.stringify({ ticketId, stepId }) }).catch(() => {});
  },
  search: (q) => req('GET', `/api/search?q=${encodeURIComponent(q)}`),
  drift: (state) => req('GET', `/api/drift?state=${state}`),
  driftUpdate: (i, patch) => req('PUT', `/api/drift/${i}`, patch),
  achievements: () => req('GET', '/api/achievements'),
  bulk: (action, targets, dryRun = false) => req('POST', '/api/bulk', { action, ...targets, dryRun }),
  bulkUndo: (undo) => req('POST', '/api/bulk/undo', undo),
  plan: (today) => req('GET', `/api/plan?today=${today}`),
  planPreview: (plan, today) => req('POST', `/api/plan/preview?today=${today}`, plan),
  planSave: (plan, today) => req('PUT', `/api/plan?today=${today}`, plan),
  planManual: (patch, today) => req('PUT', `/api/plan/manual?today=${today}`, patch),
  planManualClear: () => req('DELETE', '/api/plan/manual', {}),
  planClear: () => req('DELETE', '/api/plan', {}),
  info: () => req('GET', '/api/info'),
  config: () => fetch('/api/config').then((r) => (r.ok ? r.json() : { hosted: false })).catch(() => ({ hosted: false })),
  me: () => req('GET', '/api/me'),
  onboard: (body) => req('POST', '/api/onboarding', body),
  people: () => req('GET', '/api/admin/people'),
  invite: (email) => req('POST', '/api/admin/invite', { email }),
  revoke: (email) => req('DELETE', '/api/admin/invite', { email }),
  import: (files) => req('POST', '/api/import', files ? { files } : {}),
  exportAll: () => req('POST', '/api/export', {}),
};
