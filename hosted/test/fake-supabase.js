// A tiny fake of the parts of Supabase the hosted server talks to, backed by a REAL local Postgres (via psql),
// so the real SQL, row-level security and functions run in tests. Tokens look like "test.<uuid>.<email>".
import http from 'node:http';
import { execFileSync } from 'node:child_process';

export const SERVICE = 'service-key-for-tests';
export const ANON = 'anon-key-for-tests';

export function psql(sql, { db = 'tt_test', vars = {} } = {}) {
  const args = ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('psql', args, { input: sql, encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } }).trim();
}

const asUser = (uid, body, vars) => psql(`SET ROLE authenticated; SET request.jwt.claim.sub = '${uid}'; ${body}`, { vars }).split('\n').filter((l) => l && l !== 'SET').join('\n');

export function startFake() {
  const log = { invites: [] };
  const passwords = new Map(); // email -> password (browser tests only)
  const grant = (id, email) => { const t = `test.${id}.${email}`; return { access_token: t, refresh_token: t, expires_in: 3600, token_type: 'bearer', user: { id, email } }; };
  const server = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'apikey, authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const out = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      try {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        const u = new URL(req.url, 'http://x');
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
        const isService = req.headers.apikey === SERVICE;
        if (u.pathname === '/auth/v1/user') {
          const m = /^test\.([0-9a-f-]{36})\.(.+)$/.exec(bearer);
          return m ? out(200, { id: m[1], email: m[2] }) : out(401, { msg: 'invalid' });
        }
        if (u.pathname === '/auth/v1/signup') {
          const email = String(body.email || '').toLowerCase();
          try { const id = psql(`INSERT INTO auth.users (email) VALUES ('${email.replace(/'/g, "''")}') RETURNING id;`).split('\n')[0]; passwords.set(email, body.password); return out(200, grant(id, email)); }
          catch { return out(500, { msg: 'Database error saving new user' }); }
        }
        if (u.pathname === '/auth/v1/token') {
          if (u.searchParams.get('grant_type') === 'refresh_token') { const m = /^test\.([0-9a-f-]{36})\.(.+)$/.exec(body.refresh_token || ''); return m ? out(200, grant(m[1], m[2])) : out(400, { error_description: 'bad refresh' }); }
          const email = String(body.email || '').toLowerCase();
          if (!passwords.has(email) || passwords.get(email) !== body.password) return out(400, { error_description: 'Invalid login credentials' });
          return out(200, grant(psql(`SELECT id FROM auth.users WHERE email='${email.replace(/'/g, "''")}';`), email));
        }
        if (u.pathname === '/auth/v1/recover') return out(200, {});
        if (u.pathname === '/auth/v1/logout') return out(204);
        if (u.pathname === '/auth/v1/user' && req.method === 'PUT') { const m = /^test\.([0-9a-f-]{36})\.(.+)$/.exec(bearer); if (!m) return out(401, {}); passwords.set(m[2], body.password); return out(200, { id: m[1], email: m[2] }); }
        if (u.pathname === '/auth/v1/invite') { if (!isService) return out(401); log.invites.push(body.email); return out(200, { email: body.email }); }
        if (u.pathname.startsWith('/rest/v1/rpc/')) {
          const m = /^test\.([0-9a-f-]{36})\./.exec(bearer);
          if (!m) return out(401, { message: 'JWT invalid' });
          const fn = u.pathname.split('/').pop();
          if (fn === 'tt_state') return out(200, JSON.parse(asUser(m[1], `SELECT public.tt_state(${Number(body.p_days) | 0});`)));
          if (fn === 'tt_apply') return out(200, JSON.parse(asUser(m[1], `SELECT public.tt_apply(:'a'::jsonb);`, { a: JSON.stringify(body.p) })));
          return out(404, {});
        }
        if (u.pathname.startsWith('/rest/v1/')) {
          if (!isService) return out(401, { message: 'service only' });
          const table = u.pathname.split('/').pop();
          const eq = (k) => { const v = u.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
          const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
          if (table === 'tt_profiles' && req.method === 'PATCH') {
            psql(`UPDATE tt_profiles SET start_mode=${q(body.start_mode)}, start_ticket=${body.start_ticket ? q(body.start_ticket) : 'NULL'}, marked_previous=${body.marked_previous ? 'true' : 'false'}, onboarded_at=now() WHERE user_id=${q(eq('user_id'))};`);
            return out(204);
          }
          if (table === 'tt_profiles' && req.method === 'GET') return out(200, JSON.parse(psql(`SELECT coalesce(json_agg(p),'[]') FROM (SELECT email, role, start_mode, created_at${eq('email') ? ', user_id' : ''} FROM tt_profiles ${eq('email') ? `WHERE email=${q(eq('email'))}` : ''} ORDER BY created_at) p;`)));
          if (table === 'tt_allowed_emails' && req.method === 'GET') return out(200, JSON.parse(psql(`SELECT coalesce(json_agg(a),'[]') FROM (SELECT email, role, created_at FROM tt_allowed_emails ORDER BY created_at) a;`)));
          if (table === 'tt_allowed_emails' && req.method === 'POST') { psql(`INSERT INTO tt_allowed_emails (email, role) VALUES (${q(body.email)}, ${q(body.role)}) ON CONFLICT DO NOTHING;`); return out(201); }
          if (table === 'tt_allowed_emails' && req.method === 'DELETE') { psql(`DELETE FROM tt_allowed_emails WHERE email=${q(eq('email'))};`); return out(204); }
        }
        out(404, { message: 'fake: unhandled ' + req.method + ' ' + req.url });
      } catch (e) { out(500, { message: String(e.message).slice(0, 300) }); }
    });
  });
  return new Promise((r) => server.listen(Number(process.env.FAKE_PORT) || 0, '127.0.0.1', () => r({ grant, url: `http://127.0.0.1:${server.address().port}`, log, close: () => new Promise((x) => server.close(x)) })));
}
