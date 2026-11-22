// Per-ticket extras: priority, labels, subtasks, attached files, blocked reason.
// Stored as one small JSON value per ticket in the `meta` table (key "tk:<ticket id>"), so local mode, backups
// and the hosted per-user store all carry it without any schema change. Files themselves live elsewhere
// (data/files on disk locally, Supabase Storage when hosted); only their descriptions are kept here.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getMeta, setMeta } from './db.js';

export const KEY = (id) => `tk:${id}`;
export const MAX_FILE = 25 * 1024 * 1024;
const MAX_SUB = 100, MAX_FILES = 30, MAX_LABELS = 8, MAX_COMMENTS = 200, MAX_DEPS = 10;
const SAFE_INLINE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
export const isInline = (mime) => SAFE_INLINE.has(mime);
const rid = () => randomBytes(6).toString('hex');
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export const EMPTY = () => ({ p: 0, l: [], s: [], f: [], b: '', c: [], d: [] });

export function readExtras(db, id) {
  let v = null;
  try { v = JSON.parse(getMeta(db, KEY(id)) || 'null'); } catch {}
  return normalize(v || {}, { keepFiles: true });
}

/** Cleans a client-supplied object. Files are only accepted in hosted mode (opts.files) with a strict shape. */
export function normalize(v, { keepFiles = false, files = null } = {}) {
  const o = EMPTY();
  o.p = Number.isInteger(v.p) && v.p >= 1 && v.p <= 3 ? v.p : 0;
  o.l = [...new Set((Array.isArray(v.l) ? v.l : []).map((x) => str(x, 20)).filter(Boolean))].slice(0, MAX_LABELS);
  const seen = new Set();
  o.s = (Array.isArray(v.s) ? v.s : []).slice(0, MAX_SUB).map((x) => {
    let i = typeof x?.i === 'string' && /^[a-z0-9]{4,16}$/.test(x.i) && !seen.has(x.i) ? x.i : rid();
    seen.add(i);
    return { i, t: str(x?.t, 200), d: x?.d ? 1 : 0 };
  }).filter((x) => x.t);
  o.b = str(v.b, 200);
  o.d = [...new Set((Array.isArray(v.d) ? v.d : []).map((x) => str(x, 40)).filter((x) => /^[A-Za-z0-9_.-]{1,40}$/.test(x)))].slice(0, MAX_DEPS);
  const cseen = new Set();
  o.c = (Array.isArray(v.c) ? v.c : []).slice(-MAX_COMMENTS).map((x) => {
    const i = typeof x?.i === 'string' && /^[a-z0-9]{4,16}$/.test(x.i) && !cseen.has(x.i) ? x.i : rid();
    cseen.add(i);
    const at = Number(x?.at);
    return { i, w: x?.w === 'ai' ? 'ai' : 'me', t: String(x?.t ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 2000), at: Number.isFinite(at) && at > 0 ? Math.floor(at) : Date.now() };
  }).filter((x) => x.t);
  const src = files ?? (keepFiles ? v.f : []);
  o.f = (Array.isArray(src) ? src : []).slice(0, MAX_FILES).map((x) => {
    const k = x?.k === 'sb' ? 'sb' : 'local';
    const f = { i: str(x?.i, 24).replace(/[^a-z0-9]/gi, '') || rid(), n: str(x?.n, 120) || 'file', m: str(x?.m, 80) || 'application/octet-stream', z: Math.max(0, Math.min(MAX_FILE, Number(x?.z) || 0)), k };
    if (k === 'sb') f.p = str(x?.p, 300);
    return f;
  }).filter((f) => f.k === 'local' || /^[0-9a-f-]{36}\/[^/]+\/[^/]+$/i.test(f.p || ''));
  return o;
}

const isEmpty = (o) => !o.p && !o.l.length && !o.s.length && !o.f.length && !o.b && !o.c.length && !o.d.length;

export function writeExtras(db, id, o) {
  if (isEmpty(o)) db.prepare('DELETE FROM meta WHERE key=?').run(KEY(id));
  else setMeta(db, KEY(id), JSON.stringify(o));
}

/** Compact map for the board and timeline: only tickets that have something. */
export function summary(db) {
  const out = {};
  for (const r of db.prepare(`SELECT key, value FROM meta WHERE key LIKE 'tk:%'`).all()) {
    let o; try { o = normalize(JSON.parse(r.value), { keepFiles: true }); } catch { continue; }
    out[r.key.slice(3)] = { p: o.p, l: o.l, sd: o.s.filter((x) => x.d).length, st: o.s.length, fn: o.f.length, cn: o.c.length, dp: o.d, img: o.f.filter((f) => f.m.startsWith('image/')).length, b: o.b };
  }
  return out;
}

// ---- local file storage
export const filesDir = (cfg) => path.join(cfg.dataDir, 'files');
export function saveLocalFile(cfg, { name, mime, data }) {
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw new Error('The file is empty.');
  if (buf.length > MAX_FILE) throw new Error('Files can be up to 25 MB.');
  const id = rid() + rid();
  fs.mkdirSync(filesDir(cfg), { recursive: true });
  fs.writeFileSync(path.join(filesDir(cfg), id), buf);
  return { i: id, n: str(name, 120) || 'file', m: str(mime, 80) || 'application/octet-stream', z: buf.length, k: 'local' };
}
export const localPath = (cfg, id) => (/^[a-f0-9]{24}$/.test(id) ? path.join(filesDir(cfg), id) : null);
