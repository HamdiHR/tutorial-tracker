import { engine } from './engine.js';
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
  if (tokenProvider && method === 'GET') { const local = await engine.read(url); if (local !== undefined) return local; } // hosted: answered by the local engine when it is ready
  if (!tokenProvider || method === 'GET') return serverReq(method, url, body);
  // Hosted writes carry an operation id, so a retry (after a dropped connection) is applied at most once.
  const op = crypto.randomUUID();
  if (engine.hasPending()) return queued(op, method, url, body); // earlier changes are still waiting to upload: stay in order behind them
  let data;
  try { data = await serverReq(method, url, body, op); }
  catch (e) { if (e.network && engine.canQueue(method, url)) return queued(op, method, url, body); throw e; } // offline: save on this device, upload later
  engine.wrote(method, url, body);
  return data;
}
async function queued(op, method, url, body) {
  const data = await engine.enqueue(op, method, url, body);
  if (Array.isArray(data?.unlocked) && data.unlocked.length) onUnlocked?.(data.unlocked);
  return data;
}
async function serverReq(method, url, body, opId) {
  const init = { method, headers: await authHeaders() };
  if (opId) init.headers['x-op-id'] = opId;
  if (method !== 'GET') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let r; const sentAt = Date.now();
  try {
    r = await fetch(url, init);
  } catch {
    throw Object.assign(new Error(tokenProvider ? 'Cannot reach the server. Check your connection.' : 'Cannot reach the local server. Is Tutorial Tracker still running?'), { network: true });
  }
  if (tokenProvider) engine.noteServerTime(r, sentAt);
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
  views: () => req('GET', '/api/views'),
  saveViews: (views) => req('PUT', '/api/views', { views }),
  bulkUndo: (undo) => req('POST', '/api/bulk/undo', undo),
  plan: (today) => req('GET', `/api/plan?today=${today}`),
  planPreview: (plan, today) => req('POST', `/api/plan/preview?today=${today}`, plan),
  planScenario: (changes, today) => req('POST', `/api/plan/scenario?today=${today}`, { changes }),
  planSave: (plan, today) => req('PUT', `/api/plan?today=${today}`, plan),
  planManual: (patch, today) => req('PUT', `/api/plan/manual?today=${today}`, patch),
  planManualClear: () => req('DELETE', '/api/plan/manual', {}),
  planClear: () => req('DELETE', '/api/plan', {}),
  info: () => req('GET', '/api/info'),
  // Remembered after the first successful load, so the app can start offline (it is public information: the project URL and publishable key).
  config: () => fetch('/api/config').then((r) => { if (!r.ok) return { hosted: false }; return r.json().then((c) => { try { if (c.hosted) localStorage.setItem('tt.cfg', JSON.stringify(c)); } catch {} return c; }); })
    .catch(() => { let c = null; try { c = JSON.parse(localStorage.getItem('tt.cfg') || 'null'); } catch {} if (c?.hosted) return c; const e = new Error('Cannot reach the server. Check your connection.'); e.network = true; throw e; }),
  me: () => req('GET', '/api/me'),
  onboard: (body) => req('POST', '/api/onboarding', body),
  people: () => req('GET', '/api/admin/people'),
  invite: (email) => req('POST', '/api/admin/invite', { email }),
  revoke: (email) => req('DELETE', '/api/admin/invite', { email }),
  import: (files) => req('POST', '/api/import', files ? { files } : {}),
  exportAll: () => req('POST', '/api/export', {}),
};
