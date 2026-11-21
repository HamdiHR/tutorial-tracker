import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, backupDb } from './db.js';
import { createApi, HttpError } from './api.js';
import { importFiles, readContentDir } from './importer.js';
import { migrateStatusOverrides } from './progress.js';
import { seedBadges } from './badges.js';
import { createStatic, sendJsonCached } from './static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
  return {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    host: env.HOST || '127.0.0.1',
    port: env.PORT !== undefined ? Number(env.PORT) : 4173,
    dataDir,
    dbPath: path.join(dataDir, 'tutorial.db'),
    contentDir: path.resolve(env.CONTENT_DIR || path.join(ROOT, 'content')),
    exportDir: path.resolve(env.EXPORT_DIR || path.join(ROOT, 'export')),
    publicDir: path.join(ROOT, 'public'),
  };
}

function readBody(req, limit = 40_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(db, cfg) {
  const api = createApi(db, cfg);
  const allowedHosts = (port) => new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
    res.end(body);
  };
  const baseHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const sendJson = (req, res, status, obj) => sendJsonCached(req, res, status, obj, baseHeaders);
  const serveStatic = createStatic(cfg.publicDir, MIME);

  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address()?.port ?? cfg.port;
      // Block DNS-rebinding: only answer to our own host names.
      if (!allowedHosts(port).has(String(req.headers.host || '').toLowerCase())) return send(res, 403, 'Forbidden host');

      const url = new URL(req.url, `http://${req.headers.host}`);
      const method = req.method || 'GET';

      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (method !== 'GET' && method !== 'HEAD') {
          // JSON-only (forces a CORS preflight for other sites, which we never answer).
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json');
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
          body = await readBody(req);
        }
        const out = api(method === 'HEAD' ? 'GET' : method, url.pathname, url.searchParams, body);
        if (out && out.__raw) {
          return send(res, 200, out.body, {
            'Content-Type': out.type,
            'Content-Disposition': `attachment; filename="${out.filename.replace(/"/g, '')}"`,
          });
        }
        return sendJson(req, res, 200, out);
      }

      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (!serveStatic(req, res, url.pathname, method, baseHeaders)) return send(res, 404, 'Not found');
      return;
    } catch (e) {
      if (e instanceof HttpError) return sendJson(req, res, e.status, { error: e.message });
      console.error(e);
      return sendJson(req, res, 500, { error: 'Internal error' });
    }
  });
  return server;
}

export function boot(cfg = loadConfig()) {
  const db = openDb(cfg.dbPath);
  const empty = db.prepare('SELECT count(*) n FROM sprints').get().n === 0;
  if (empty) {
    const files = readContentDir(cfg.contentDir);
    if (files.length) {
      const r = importFiles(db, files);
      console.log(`First run: imported ${r.sprints} sprints, ${r.tickets.added} sections, ${r.steps.added} steps from ${cfg.contentDir}`);
    } else {
      console.log(`No tutorial files in ${cfg.contentDir}. Put your sprint-*.md files there, or import them from Settings.`);
    }
  } else {
    backupDb(db, cfg.dataDir);
  }
  const fixed = migrateStatusOverrides(db);
  if (fixed) console.log(`Upgrade: ${fixed} ticket(s) marked Done now have all their steps ticked, so progress totals agree.`);
  seedBadges(db);
  return { db, server: createServer(db, cfg), cfg };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, cfg } = boot();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${cfg.port} is already in use. Tutorial Tracker may already be running: http://localhost:${cfg.port}`);
    else console.error(e);
    process.exit(1);
  });
  server.listen(cfg.port, cfg.host, () => console.log(`Tutorial Tracker running at http://localhost:${cfg.port}  (Ctrl+C to stop)`));
}
