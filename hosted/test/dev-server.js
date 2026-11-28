// Runs the REAL hosted handler + built UI locally against the fake Supabase (real Postgres underneath), for browser tests.
//   PGHOST=/tmp PGPORT=5544 PGUSER=postgres PORT=4300 node --disable-warning=ExperimentalWarning hosted/test/dev-server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHosted, HttpError } from '../handler.js';
import { startFake, psql, SERVICE, ANON } from './fake-supabase.js';
import { createStatic } from '../../server/static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
psql(`TRUNCATE tt_user_steps, tt_user_tickets, tt_drift, tt_step_versions, tt_activity, tt_badges, tt_meta, tt_profiles, tt_allowed_emails; DELETE FROM auth.users;
      INSERT INTO tt_allowed_emails (email, role) VALUES ('owner@x.com','owner'), ('friend@x.com','member');`);
const fake = await startFake();
const app = createHosted({ env: { SUPABASE_URL: fake.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE }, contentPath: path.join(ROOT, 'hosted/content.db'), version: 'dev' });
const serve = createStatic(path.join(ROOT, 'public'), { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' });
const server = http.createServer(async (req, res) => {
  const send = (st, obj) => { res.writeHead(st, { 'content-type': 'application/json', 'x-server-time': String(Date.now() + (Number(process.env.E2E_SERVER_SKEW) || 0)) }); res.end(JSON.stringify(obj)); };
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      const out = await app.handle(req.method, req.url, req.headers, body);
      for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
      return send(out.status, out.json);
    }
    if (!serve(req, res, u.pathname, req.method, {})) { res.writeHead(404); res.end('nf'); }
  } catch (e) { if (e instanceof HttpError) return send(e.status, { error: e.message }); console.error(e); send(500, { error: 'Internal error' }); }
});
server.listen(Number(process.env.PORT) || 4300, '127.0.0.1', () => console.log('dev hosted server on', server.address().port, 'fake supabase', fake.url));
