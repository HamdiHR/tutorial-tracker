// Vercel serverless entry: every /api/* request lands here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHosted, HttpError } from '../hosted/handler.js';

if (process.env.APP_TZ) process.env.TZ = process.env.APP_TZ; // day boundaries for streaks follow your time zone
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8'));
const app = createHosted({ env: process.env, contentPath: path.join(here, '../hosted/content.db'), version: pkg.version });

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 5_000_000) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(JSON.stringify(obj));
  };
  try {
    const method = req.method || 'GET';
    let body = {};
    if (method !== 'GET' && method !== 'HEAD') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json');
      body = await readJson(req);
    }
    const out = await app.handle(method, req.url, req.headers, body);
    send(out.status, out.json);
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error(e);
    send(500, { error: 'Internal error' });
  }
}
