// Static file serving with in-memory cache, ETag/304, Brotli/gzip (pre-built .br/.gz are used when present),
// and long-lived caching for content-hashed files under /assets/. Also compression + ETag for JSON.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.map']);
const MIN = 1024;
const etagOf = (buf) => '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 22) + '"';

/** Best encoding the client accepts: br > gzip > identity. */
export function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

const notModified = (req, etag) => {
  const inm = req.headers['if-none-match'];
  return !!inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
};

export function createStatic(publicDir, mime) {
  const cache = new Map(); // absolute file -> entry

  function entry(file) {
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const buf = fs.readFileSync(file);
    const ext = path.extname(file);
    const e = { mtimeMs: st.mtimeMs, size: st.size, buf, etag: etagOf(buf), br: null, gzip: null };
    if (COMPRESSIBLE.has(ext) && buf.length >= MIN) {
      const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
      e.br = read(file + '.br') || zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      e.gzip = read(file + '.gz') || zlib.gzipSync(buf, { level: 6 });
    }
    cache.set(file, e);
    return e;
  }

  /** Returns false when the path is not a servable file (caller sends 404). */
  return function serve(req, res, pathname, method, baseHeaders) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(publicDir, path.normalize(rel));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    if (file.endsWith('.br') || file.endsWith('.gz')) return false; // only reachable through negotiation
    const e = entry(file);
    const enc = pickEncoding(req);
    const variant = enc === 'br' && e.br ? 'br' : enc === 'gzip' && e.gzip ? 'gzip' : null;
    const etag = variant ? etag_(e.etag, variant) : e.etag;
    const hashed = rel.startsWith('/assets/');
    const headers = {
      ...baseHeaders,
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      ETag: etag,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      Vary: 'Accept-Encoding',
    };
    if (notModified(req, etag)) { res.writeHead(304, headers); res.end(); return true; }
    const body = variant ? e[variant] : e.buf;
    if (variant) headers['Content-Encoding'] = variant;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  };
}
const etag_ = (tag, variant) => tag.slice(0, -1) + '-' + variant + '"';

/** JSON response: ETag (so unchanged data answers 304) and gzip for bigger bodies. */
export function sendJsonCached(req, res, status, obj, baseHeaders = {}) {
  const text = JSON.stringify(obj);
  const headers = { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' };
  const cacheable = req.method === 'GET' && status === 200;
  headers['Cache-Control'] = cacheable ? 'no-cache' : 'no-store';
  let body = Buffer.from(text);
  const enc = pickEncoding(req);
  if (body.length >= MIN && enc) {
    body = enc === 'br' ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } }) : zlib.gzipSync(body, { level: 4 });
    headers['Content-Encoding'] = enc;
  }
  if (cacheable) {
    const tag = etagOf(Buffer.from(text));
    headers.ETag = enc && headers['Content-Encoding'] ? tag.slice(0, -1) + '-' + enc + '"' : tag;
    if (notModified(req, headers.ETag)) { res.writeHead(304, headers); res.end(); return; }
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
