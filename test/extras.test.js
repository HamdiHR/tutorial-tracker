import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, loadConfig } from '../server/index.js';
import { normalize } from '../server/extras.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-x-'));
  const cfg = loadConfig({ DATA_DIR: dir, CONTENT_DIR: path.join(ROOT, 'content'), EXPORT_DIR: path.join(dir, 'export'), PORT: '0' });
  const { server, db } = boot(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), res };
  };
  return { call, dir, close: () => new Promise((r) => server.close(r)) };
}
const TID = 'S1-T01';

test('extras: priority, labels, subtasks round-trip and are cleaned', async (t) => {
  const s = await start();
  t.after(() => s.close());
  const first = (await s.call('GET', '/api/overview')).data.sprints[0].items.find((t) => t.kind === 'ticket').id;
  const put = await s.call('PUT', `/api/tickets/${encodeURIComponent(first)}/extras`, { p: 2, l: ['bug', 'bug', ' ui '], s: [{ t: 'write test', d: 1 }, { t: '   ' }, { t: 'refactor' }], b: 'waiting on API' });
  assert.equal(put.status, 200);
  assert.equal(put.data.p, 2);
  assert.deepEqual(put.data.l, ['bug', 'ui']);
  assert.equal(put.data.s.length, 2);
  const sum = (await s.call('GET', '/api/extras')).data;
  assert.deepEqual([sum[first].sd, sum[first].st, sum[first].b], [1, 2, 'waiting on API']);
  await s.call('PUT', `/api/tickets/${encodeURIComponent(first)}/extras`, {});
  assert.deepEqual((await s.call('GET', '/api/extras')).data, {}); // empty extras leave no trace
});

test('extras: unknown ticket is 404, junk input is bounded', async (t) => {
  const s = await start();
  t.after(() => s.close());
  assert.equal((await s.call('PUT', '/api/tickets/NOPE/extras', { p: 1 })).status, 404);
  const o = normalize({ p: 99, l: Array.from({ length: 30 }, (_, i) => 'l' + i), s: Array.from({ length: 300 }, (_, i) => ({ t: 'x' + i })), b: 'y'.repeat(999) });
  assert.equal(o.p, 0); assert.equal(o.l.length, 8); assert.equal(o.s.length, 100); assert.equal(o.b.length, 200);
});

test('files (local): upload, list, download inline for images, attachment for others, delete', async (t) => {
  const s = await start();
  t.after(() => s.close());
  const first = (await s.call('GET', '/api/overview')).data.sprints[0].items.find((t) => t.kind === 'ticket').id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = await s.call('POST', `/api/tickets/${encodeURIComponent(first)}/files`, { name: 'shot.png', mime: 'image/png', data: png.toString('base64') });
  assert.equal(up.status, 200);
  const fid = up.data.file.i;
  const dl = await s.call('GET', `/api/files/${fid}`);
  assert.equal(dl.status, 200);
  assert.match(dl.res.headers.get('content-disposition'), /^inline/);
  assert.equal(dl.res.headers.get('content-type'), 'image/png');
  assert.deepEqual(dl.data, png);
  const html = await s.call('POST', `/api/tickets/${encodeURIComponent(first)}/files`, { name: 'x.html', mime: 'text/html', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
  const h = await s.call('GET', `/api/files/${html.data.file.i}`);
  assert.match(h.res.headers.get('content-disposition'), /^attachment/);
  assert.equal(h.res.headers.get('content-type'), 'application/octet-stream');
  assert.equal((await s.call('GET', '/api/files/../../etc/passwd')).status, 404);
  assert.equal((await s.call('GET', '/api/files/ffffffffffffffffffffffff')).status, 404);
  // PUT cannot smuggle file entries in locally
  await s.call('PUT', `/api/tickets/${encodeURIComponent(first)}/extras`, { f: [{ i: 'aaaaaaaaaaaaaaaaaaaaaaaa', n: 'ghost', k: 'local' }], p: 1 });
  const got = (await s.call('GET', `/api/tickets/${encodeURIComponent(first)}/extras`)).data;
  assert.deepEqual(got.f.map((f) => f.n).sort(), ['shot.png', 'x.html']);
  const del = await s.call('DELETE', `/api/tickets/${encodeURIComponent(first)}/files/${fid}`, {});
  assert.equal(del.data.extras.f.length, 1);
  assert.equal(fs.existsSync(path.join(s.dir, 'files', fid)), false);
  const big = await s.call('POST', `/api/tickets/${encodeURIComponent(first)}/files`, { name: 'e', mime: 'text/plain', data: '' });
  assert.equal(big.status, 400);
});

test('hosted-style files: only strict storage paths are accepted', () => {
  const uid = '11111111-2222-3333-4444-555555555555';
  const o = normalize({ f: [{ i: 'a1', n: 'a.png', m: 'image/png', z: 10, k: 'sb', p: `${uid}/S1-T01/a1` }, { i: 'b2', n: 'evil', k: 'sb', p: '../../x' }, { i: 'c3', n: 'bad', k: 'sb', p: `${uid}/a/b/c` }] }, { files: [{ i: 'a1', n: 'a.png', m: 'image/png', z: 10, k: 'sb', p: `${uid}/S1-T01/a1` }, { i: 'b2', n: 'evil', k: 'sb', p: '../../x' }, { i: 'c3', n: 'bad', k: 'sb', p: `${uid}/a/b/c` }] });
  assert.equal(o.f.length, 1);
  assert.equal(o.f[0].p, `${uid}/S1-T01/a1`);
});
