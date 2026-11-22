// File attachments. Images are shrunk in the browser first (max 1600 px, WebP) so the free storage lasts.
// Local mode: bytes go to the local server (data/files). Hosted: straight to Supabase Storage (private bucket,
// one folder per person, short-lived signed links), so nothing large passes through the serverless function.
import { api } from './api.js';
import { getToken } from './auth.js';

export const MAX_BYTES = 25 * 1024 * 1024;
export const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
export const isImage = (m) => /^image\/(png|jpe?g|webp|gif)$/.test(m || '');
export const icon = (m, name = '') => (isImage(m) ? '🖼' : m === 'application/pdf' ? '📕' : /zip|compressed|tar/.test(m) || /\.(zip|tar|gz|7z)$/i.test(name) ? '🗜' : /^text\/|json|javascript|xml/.test(m) || /\.(md|txt|json|js|ts|tsx|css|html|sql|sh|yml|yaml|env)$/i.test(name) ? '📄' : '📎');

let cfgP = null;
const config = () => (cfgP ||= api.config());
const uid = (jwt) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch { return null; } };
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Shrinks screenshots/photos. GIFs and small files pass through; returns a Blob and its mime. */
export async function prepare(file) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size < 150 * 1024) return { blob: file, mime: file.type || 'application/octet-stream', name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); // drawing re-encodes the pixels, which drops EXIF/GPS data
    bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
    if (blob && blob.type === 'image/webp' && blob.size < file.size) return { blob, mime: 'image/webp', name: file.name.replace(/\.[^.]+$/, '') + '.webp' };
  } catch {}
  return { blob: file, mime: file.type, name: file.name };
}

const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });

let cachedId = null;
/** Fallback when the access token is not a decodable JWT: ask the auth server who we are. */
async function userId(cfg, token) {
  if (cachedId?.t === token) return cachedId.id;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` } });
    const id = r.ok ? (await r.json()).id : null;
    if (id) cachedId = { t: token, id };
    return id;
  } catch { return null; }
}

/** Uploads one file; resolves to the updated extras object (local) or the file entry (hosted). */
export async function upload(ticketId, file, hosted) {
  if (file.size > MAX_BYTES * 2) throw new Error(`${file.name} is too large (limit ${fmtSize(MAX_BYTES)}).`);
  const { blob, mime, name } = await prepare(file);
  if (blob.size > MAX_BYTES) throw new Error(`${name} is too large (limit ${fmtSize(MAX_BYTES)}).`);
  if (!hosted) return { extras: (await api.uploadFile(ticketId, { name, mime, data: await toB64(blob) })).extras };
  const cfg = await config();
  const token = await getToken();
  const id = rnd();
  const owner = uid(token) || await userId(cfg, token);
  if (!owner) throw new Error('Please sign in again to upload files.');
  const path = `${owner}/${ticketId}/${id}`;
  const r = await fetch(`${cfg.supabaseUrl}/storage/v1/object/task-files/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'content-type': mime, 'x-upsert': 'false', 'cache-control': '3600' }, body: blob });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(/bucket not found/i.test(e.message || e.error || '') ? 'File storage is not set up yet. Redeploy so the migration creates it.' : e.message || e.error || `Upload failed (${r.status})`);
  }
  return { file: { i: id, n: name, m: mime, z: blob.size, k: 'sb', p: path } };
}

const urlCache = new Map();
/** A URL the browser can load (img src / link). Hosted: signed for an hour; local: the API route. */
export async function urlFor(f) {
  if (f.k !== 'sb') return `/api/files/${f.i}`;
  const hit = urlCache.get(f.p);
  if (hit && hit.exp > Date.now()) return hit.url;
  const cfg = await config();
  const token = await getToken();
  const r = await fetch(`${cfg.supabaseUrl}/storage/v1/object/sign/task-files/${f.p.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.signedURL) throw new Error('Could not open the file.');
  const url = `${cfg.supabaseUrl}/storage/v1${j.signedURL}`;
  urlCache.set(f.p, { url, exp: Date.now() + 50 * 60 * 1000 });
  return url;
}

export async function removeObject(f) {
  if (f.k !== 'sb') return;
  const cfg = await config();
  const token = await getToken();
  await fetch(`${cfg.supabaseUrl}/storage/v1/object/task-files/${f.p.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` } }).catch(() => {});
}
