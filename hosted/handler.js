// Hosted (Vercel + Supabase) request handler. Transport-agnostic: handle(method, url, headers, body) -> {status, json}.
// Per request: verify the person -> load their saved state (one RPC) -> run the normal app API on a private copy of the
// tutorial -> save only what changed (one RPC). Their own token is used for data calls, so Postgres row-level
// security is the real wall between people; the service key is used only for invites and the first-login flag.
import { createApi, HttpError } from '../server/api.js';
import { bulk } from '../server/progress.js';
import { award } from '../server/badges.js';
import { openWorking, hydrate, extract, diff } from './state.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function createHosted({ env = process.env, contentPath, fetchImpl = fetch, version = '0.0.0' }) {
  const base = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
  const service = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
  const siteUrl = (env.SITE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '');
  const cfg = { version, hosted: true, dataDir: '', dbPath: '', contentDir: '', exportDir: '' };
  const verified = new Map();

  const configured = () => { if (!base || !anon) throw new HttpError(503, 'Hosting is not configured (missing Supabase settings).'); };
  async function call(method, pathQuery, { key, bearer, body, headers = {} } = {}) {
    const h = { apikey: key, 'content-type': 'application/json', ...headers };
    if (bearer) h.authorization = `Bearer ${bearer}`; // the person's own access token
    else if (String(key).startsWith('eyJ')) h.authorization = `Bearer ${key}`; // legacy JWT keys; new-style secret keys are not JWTs: apikey alone is enough
    let res;
    try { res = await fetchImpl(base + pathQuery, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new HttpError(502, 'Could not reach the database.'); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  }

  async function who(token) {
    const hit = verified.get(token);
    if (hit && hit.exp > Date.now()) return hit.user;
    const r = await call('GET', '/auth/v1/user', { key: anon, bearer: token });
    if (!r.ok || !r.data?.id) throw new HttpError(401, 'Please sign in again.');
    const user = { id: r.data.id, email: String(r.data.email || '').toLowerCase() };
    if (verified.size > 200) verified.clear();
    verified.set(token, { user, exp: Date.now() + 60_000 });
    return user;
  }
  const rpc = async (name, args, token) => {
    const r = await call('POST', `/rest/v1/rpc/${name}`, { key: anon, bearer: token, body: args });
    if (r.status === 401 || r.status === 403) throw new HttpError(401, 'Please sign in again.');
    if (!r.ok) { console.error(`rpc ${name} failed`, r.status, JSON.stringify(r.data)?.slice(0, 300)); throw new HttpError(502, name.startsWith('tt_apply') ? 'Could not save your changes. Try again.' : 'Could not load your data. Try again.'); }
    return r.data;
  };
  const asService = (method, pathQuery, body, headers) => {
    if (!service) throw new HttpError(503, 'Server key missing (SUPABASE_SERVICE_ROLE_KEY).');
    return call(method, pathQuery, { key: service, body, headers });
  };

  /** Run fn(api, db, state) on this person's data; save what changed when `write`. */
  /** An operation made offline is dated when it was made, not when it uploaded. Only rows this operation changed are re-dated. */
  function retime(d, before, ms) {
    const iso = new Date(ms).toISOString();
    const was = new Map([...before.steps.values()].map((v) => [`${v.t}|${v.k}`, v.done_at]));
    for (const st of d.steps.set) if (st.done && st.done_at && was.get(`${st.t}|${st.k}`) !== st.done_at) st.done_at = iso;
    for (const a of d.activity || []) a.ts = iso;
    for (const v of d.versions || []) v.ts = iso;
  }
  async function withUser(token, write, fn, opId, opTime) {
    const state = await rpc('tt_state', { p_days: 400 }, token);
    if (!state?.profile) throw new HttpError(403, 'This account has not been invited.');
    const work = openWorking(contentPath);
    try {
      hydrate(work.db, state);
      const before = extract(work.db);
      const api = createApi(work.db, cfg);
      const out = await fn(api, work.db, state);
      if (write) {
        const d = diff(work.db, before, extract(work.db));
        if (d && opTime) retime(d, before, opTime);
        if (d) await (opId ? rpc('tt_apply_v2', { p: d, p_op: opId }, token) : rpc('tt_apply', { p: d }, token)); // with an operation id a retried save is applied at most once
      }
      return out;
    } finally { work.close(); }
  }

  const requireOwner = (state) => { if (state.profile.role !== 'owner') throw new HttpError(403, 'Only the owner can do this.'); };

  async function handle(method, url, headers, body) {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/\/+$/, '') || '/';
    if (p === '/api/health') return { status: 200, json: { ok: true, hosted: true } };
    configured();
    if (p === '/api/config' && method === 'GET') return { status: 200, json: { hosted: true, supabaseUrl: base, anonKey: anon, version } };

    const token = /^Bearer (.+)$/i.exec(String(headers.authorization || headers.Authorization || ''))?.[1];
    if (!token) throw new HttpError(401, 'Please sign in.');
    const user = await who(token);

    if (p === '/api/me' && method === 'GET') {
      return { status: 200, json: await withUser(token, false, (_a, _d, st) => ({ id: user.id, email: user.email, role: st.profile.role, onboarded: !!st.profile.start_mode, start: { mode: st.profile.start_mode, ticket: st.profile.start_ticket, markedPrevious: !!st.profile.marked_previous } })) };
    }

    if (p === '/api/onboarding' && method === 'POST') {
      return { status: 200, json: await withUser(token, true, async (api, db, st) => {
        const redo = body.redo === true;
        if (st.profile.start_mode && !redo) throw new HttpError(409, 'You already chose where to start.');
        const mode = body.mode;
        if (mode !== 'zero' && mode !== 'point') throw new HttpError(400, 'Choose "zero" or "point".');
        let marked = 0;
        let ticketId = null;
        if (redo) bulk(db, 'reset', { all: true });
        if (mode === 'point') {
          ticketId = String(body.ticketId || '');
          const order = db.prepare(`SELECT t.id FROM tickets t JOIN sprints s ON s.id=t.sprint_id WHERE t.kind='ticket' AND t.deferred=0 AND t.orphan=0 ORDER BY s.ord, t.ord`).all().map((r) => r.id);
          const at = order.indexOf(ticketId);
          if (at < 0) throw new HttpError(400, 'Unknown ticket.');
          if (body.markPrevious === true && at > 0) {
            marked = bulk(db, 'done', { ticketIds: order.slice(0, at) }).steps;
            db.prepare(`INSERT INTO activity (type, ticket_id, info) VALUES ('start', ?, ?)`).run(ticketId, `${marked} steps marked done`);
          }
          db.prepare(`INSERT INTO meta (key,value) VALUES ('resume',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify({ ticketId, stepId: null }));
        }
        award(db); // badges for what you already did are recorded silently, not celebrated
        return { mode, ticketId, marked, markPrevious: body.markPrevious === true, redo };
      }).then(async (res) => {
        const r = await asService('PATCH', `/rest/v1/tt_profiles?user_id=eq.${encodeURIComponent(user.id)}`, { start_mode: res.mode, start_ticket: res.ticketId, marked_previous: res.mode === 'point' && res.markPrevious, onboarded_at: new Date().toISOString() }, { Prefer: 'return=minimal' });
        if (!r.ok) throw new HttpError(502, 'Could not save your choice. Try again.');
        return { ok: true, mode: res.mode, ticketId: res.ticketId, marked: res.marked };
      }) };
    }

    if (p.startsWith('/api/admin/')) {
      const st = await rpc('tt_state', { p_days: 1 }, token);
      if (!st?.profile) throw new HttpError(403, 'This account has not been invited.');
      requireOwner(st);
      if (p === '/api/admin/people' && method === 'GET') {
        const [al, pr] = await Promise.all([asService('GET', '/rest/v1/tt_allowed_emails?select=email,role,created_at&order=created_at'), asService('GET', '/rest/v1/tt_profiles?select=email,role,start_mode,created_at&order=created_at')]);
        if (!al.ok || !pr.ok) throw new HttpError(502, 'Could not load people.');
        const joined = new Map(pr.data.map((x) => [x.email, x]));
        return { status: 200, json: { people: al.data.map((a) => ({ email: a.email, role: a.role, joined: joined.has(a.email), onboarded: !!joined.get(a.email)?.start_mode })) } };
      }
      if (p === '/api/admin/invite' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
        const r = await asService('POST', '/rest/v1/tt_allowed_emails?on_conflict=email', { email, role: 'member', invited_by: user.id }, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
        if (!r.ok) throw new HttpError(502, 'Could not save the invite.');
        let sent = false;
        const inv = await asService('POST', `/auth/v1/invite${siteUrl ? `?redirect_to=${encodeURIComponent(siteUrl)}` : ''}`, { email });
        sent = inv.ok;
        return { status: 200, json: { ok: true, email, emailSent: sent, note: sent ? 'Invitation email sent.' : 'Invite saved. The email could not be sent (it may already have an account, or the email limit was reached). They can still open the site and choose "Create account" with this email.' } };
      }
      if (p === '/api/admin/invite' && method === 'DELETE') {
        const email = String(body.email || '').trim().toLowerCase();
        const pr = await asService('GET', `/rest/v1/tt_profiles?select=user_id&email=eq.${encodeURIComponent(email)}`);
        if (pr.ok && pr.data.length) throw new HttpError(409, 'This person already has an account.');
        await asService('DELETE', `/rest/v1/tt_allowed_emails?email=eq.${encodeURIComponent(email)}`, undefined, { Prefer: 'return=minimal' });
        return { status: 200, json: { ok: true } };
      }
      throw new HttpError(404, 'Unknown endpoint');
    }

    // The person's saved state (what tt_state returns), for the in-browser engine. Only their own rows: the call uses their token.
    if (p === '/api/state' && method === 'GET') {
      const st = await rpc('tt_state', { p_days: 400 }, token);
      if (!st?.profile) throw new HttpError(403, 'This account has not been invited.');
      return { status: 200, json: st };
    }
    if (p === '/api/info') return { status: 200, json: await withUser(token, false, (api) => ({ version, hosted: true, sprints: api('GET', '/api/overview', new URLSearchParams(), {}).sprints.map((s) => ({ id: s.id, title: s.title })) })) };
    if (/^\/api\/(import|export)/.test(p)) throw new HttpError(404, 'Not available in the hosted version.');
    if (!p.startsWith('/api/')) throw new HttpError(404, 'Not found');

    const write = method !== 'GET' && method !== 'HEAD';
    const op = String(headers['x-op-id'] || '');
    const opId = write && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(op) ? op.toLowerCase() : null;
    // Offline changes carry the time they were made (x-op-time, ms). Accepted only if it is in the past and at most 30 days old.
    const t = Number(headers['x-op-time']), now = Date.now();
    const opTime = opId && Number.isFinite(t) && t <= now && t >= now - 30 * 86400_000 ? Math.floor(t) : null;
    const out = await withUser(token, write, (api) => api(method === 'HEAD' ? 'GET' : method, p, u.searchParams, body || {}), opId, opTime);
    return { status: 200, json: out };
  }

  return { handle };
}
export { HttpError };
