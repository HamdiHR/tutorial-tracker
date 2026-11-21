import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, loadConfig } from '../server/index.js';
import { openDb } from '../server/db.js';
import { importFiles, readContentDir, exportAllToDir } from '../server/importer.js';
import { normalise } from '../server/parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));

async function start(contentDir = CONTENT) {
  const dir = tmp();
  const cfg = loadConfig({ DATA_DIR: dir, CONTENT_DIR: contentDir, EXPORT_DIR: path.join(dir, 'export'), PORT: '0' });
  const { server, db } = boot(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), res };
  };
  return { call, port, db, cfg, close: () => new Promise((r) => server.close(r)) };
}

test('real files: import counts and byte-identical export', () => {
  const db = openDb(':memory:');
  importFiles(db, readContentDir(CONTENT));
  assert.equal(db.prepare(`SELECT count(*) n FROM tickets WHERE kind='ticket'`).get().n, 145 + 3);
  const dir = tmp();
  const files = exportAllToDir(db, dir);
  assert.equal(files.length, 11);
  for (const f of files) {
    assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), normalise(fs.readFileSync(path.join(CONTENT, f), 'utf8')), f);
  }
});

test('overview, ticket detail, done toggling and derived status', async () => {
  const t = await start();
  try {
    let { data: ov } = await t.call('GET', '/api/overview');
    assert.equal(ov.sprints.length, 11);
    assert.ok(ov.totals.steps > 700);
    assert.equal(ov.totals.stepsDone, 0);
    assert.equal(ov.current.ticketId, 'S0-P1'); // first trackable section

    const { data: d } = await t.call('GET', '/api/tickets/S0-T01');
    assert.equal(d.ticket.status, 'todo');
    const checkable = d.steps.filter((s) => s.kind === 'step' || s.kind === 'verify');
    assert.ok(checkable.length > 5);

    await t.call('POST', `/api/steps/${checkable[0].id}/done`, { done: true });
    let r = await t.call('GET', '/api/tickets/S0-T01');
    assert.equal(r.data.ticket.status, 'doing');
    for (const s of checkable) await t.call('POST', `/api/steps/${s.id}/done`, { done: true });
    r = await t.call('GET', '/api/tickets/S0-T01');
    assert.equal(r.data.ticket.status, 'done');

    // intro slides cannot be checked
    const intro = d.steps.find((s) => s.kind === 'intro');
    assert.equal((await t.call('POST', `/api/steps/${intro.id}/done`, { done: true })).status, 400);

    // manual override + clear
    await t.call('PUT', '/api/tickets/S0-T01/status', { status: 'blocked' });
    assert.equal((await t.call('GET', '/api/tickets/S0-T01')).data.ticket.status, 'blocked');
    await t.call('PUT', '/api/tickets/S0-T01/status', { status: null });
    assert.equal((await t.call('GET', '/api/tickets/S0-T01')).data.ticket.status, 'done');
    assert.equal((await t.call('PUT', '/api/tickets/S0-T01/status', { status: 'nope' })).status, 400);

    ov = (await t.call('GET', '/api/overview')).data;
    assert.equal(ov.streak, 1);
    assert.equal(ov.activity.at(-1).n, checkable.length);
    assert.equal(ov.doneToday, checkable.length);
  } finally {
    await t.close();
  }
});

test('edit, history, reset, notes, search, drift', async () => {
  const t = await start();
  try {
    const { data: d } = await t.call('GET', '/api/tickets/S3-T01');
    const step = d.steps.find((s) => s.kind === 'step');
    const orig = step.body;

    let r = await t.call('PUT', `/api/steps/${step.id}`, { title: step.title, body: orig + '\n\nMy fix: zebra-crossing-widget 🔍 check this' });
    assert.equal(r.data.edited, true);
    const after = (await t.call('GET', '/api/tickets/S3-T01')).data.steps.find((s) => s.id === step.id);
    assert.equal(after.edited, true);

    const v = (await t.call('GET', `/api/steps/${step.id}/versions`)).data;
    assert.equal(v.original.body, orig);
    assert.equal(v.versions.length, 1);

    const s1 = (await t.call('GET', '/api/search?q=zebra-crossing')).data.results;
    assert.ok(s1.some((x) => x.id === step.id), 'edited text is searchable');
    const dr = (await t.call('GET', '/api/drift?state=open')).data.items;
    assert.ok(dr.some((x) => x.step_id === step.id && x.line.includes('check this')));

    await t.call('PUT', `/api/steps/${step.id}/note`, { note: 'remember quokka setting' });
    assert.ok((await t.call('GET', '/api/search?q=quokka')).data.results.length === 1);

    await t.call('POST', `/api/steps/${step.id}/reset`, {});
    const back = (await t.call('GET', '/api/tickets/S3-T01')).data.steps.find((s) => s.id === step.id);
    assert.equal(back.body, orig);
    assert.equal(back.edited, false);
    assert.equal((await t.call('GET', '/api/search?q=zebra-crossing')).data.results.length, 0);
    assert.equal((await t.call('GET', '/api/steps/' + step.id + '/versions')).data.versions.length, 2);

    // drift state is kept
    const some = (await t.call('GET', '/api/drift?state=open')).data.items[0];
    await t.call('PUT', `/api/drift/${some.id}`, { state: 'checked', note: 'ok in 1.2' });
    const checked = (await t.call('GET', '/api/drift?state=checked')).data;
    assert.equal(checked.items.length, 1);
    assert.equal(checked.counts.checked, 1);

    await t.call('PUT', '/api/tickets/S3-T01/note', { note: 'ticket note' });
    assert.equal((await t.call('GET', '/api/tickets/S3-T01')).data.ticket.note, 'ticket note');
  } finally {
    await t.close();
  }
});

test('smart merge: unedited follow upstream, edited are kept + flagged, progress survives', async () => {
  const content = tmp();
  const md1 = `# Doc\n\n## 🎫 S9-T01 — First\n\nintro\n\n### 1. Alpha\n\nalpha text\n\n### 2. Beta\n\nbeta text\n\n### ✅ Verify\n\n- ok\n\n---\n`;
  fs.writeFileSync(path.join(content, 'sprint-09-tutorial.md'), md1);
  const t = await start(content);
  try {
    const d = (await t.call('GET', '/api/tickets/S9-T01')).data;
    const [alpha, beta] = d.steps.filter((s) => s.kind === 'step');
    await t.call('POST', `/api/steps/${alpha.id}/done`, { done: true });
    await t.call('PUT', `/api/steps/${beta.id}`, { title: '2. Beta', body: 'beta text (mine)' });

    const md2 = md1.replace('alpha text', 'alpha text v2').replace('beta text', 'beta text v2').replace('### ✅ Verify', '### 3. Gamma\n\nnew step\n\n### ✅ Verify');
    const rep = (await t.call('POST', '/api/import', { files: [{ name: 'sprint-09-tutorial.md', text: md2 }] })).data.report;
    assert.equal(rep.steps.added, 1);
    assert.equal(rep.steps.flagged, 1);

    const n = (await t.call('GET', '/api/tickets/S9-T01')).data.steps;
    const a2 = n.find((s) => s.key === 'alpha');
    const b2 = n.find((s) => s.key === 'beta');
    assert.equal(a2.body, 'alpha text v2');
    assert.equal(a2.done, 1, 'progress kept');
    assert.equal(b2.body, 'beta text (mine)', 'edit kept');
    assert.equal(b2.hasUpstream, true);
    assert.equal(b2.upstream_body, 'beta text v2');
    assert.deepEqual(n.filter((s) => s.kind !== 'intro').map((s) => s.key), ['alpha', 'beta', 'gamma', 'verify']);

    // keep mine -> flag gone, still my text
    await t.call('POST', `/api/steps/${b2.id}/upstream`, { action: 'keep' });
    let b3 = (await t.call('GET', '/api/tickets/S9-T01')).data.steps.find((s) => s.key === 'beta');
    assert.equal(b3.hasUpstream, false);
    assert.equal(b3.body, 'beta text (mine)');
    // reset now goes to the NEW upstream text
    await t.call('POST', `/api/steps/${b3.id}/reset`, {});
    b3 = (await t.call('GET', '/api/tickets/S9-T01')).data.steps.find((s) => s.key === 'beta');
    assert.equal(b3.body, 'beta text v2');

    // export round trips including my change
    const exp = (await t.call('GET', '/api/export/9')).data;
    assert.equal(exp, normalise(md2));
  } finally {
    await t.close();
  }
});

test('security: host check, json-only writes, cross-origin blocked', async () => {
  const t = await start();
  try {
    const bad = await fetch(`http://127.0.0.1:${t.port}/api/overview`, { headers: { host: 'evil.example:80' } }).catch(() => null);
    // fetch forbids overriding Host in undici; use raw http instead
    const http = await import('node:http');
    const raw = (opts, body) =>
      new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: t.port, ...opts }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        if (body) req.write(body);
        req.end();
      });
    assert.equal(await raw({ path: '/api/resume', method: 'POST', headers: { 'content-type': 'text/plain' } }, '{}'), 415);
    assert.equal(await raw({ path: '/api/resume', method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' } }, '{"ticketId":"x"}'), 403);
    assert.equal(await raw({ path: '/../package.json' }), 404);
    assert.equal(await raw({ path: '/' }), 200);
    void bad;
  } finally {
    await t.close();
  }
});

test('bulk: mark sprint done, progress agrees everywhere, undo, reset, dry run', async () => {
  const t = await start();
  try {
    const ov0 = (await t.call('GET', '/api/overview')).data;
    const sp0 = ov0.sprints.find((s) => s.id === '0');
    const dry = (await t.call('POST', '/api/bulk', { action: 'done', sprintIds: ['0'], dryRun: true })).data;
    assert.equal(dry.tickets, sp0.ticketsTotal);
    assert.equal(dry.steps, sp0.total);
    assert.equal((await t.call('GET', '/api/overview')).data.totals.stepsDone, 0, 'dry run changes nothing');

    const r = (await t.call('POST', '/api/bulk', { action: 'done', sprintIds: ['0'] })).data;
    assert.equal(r.steps, sp0.total);
    const ov = (await t.call('GET', '/api/overview')).data;
    const sp = ov.sprints.find((s) => s.id === '0');
    assert.equal(sp.done, sp.total);
    assert.equal(sp.ticketsDone, sp.ticketsTotal);
    assert.equal(sp.complete, true);
    assert.equal(ov.totals.stepsDone, sp0.total, 'overall step count includes the bulk-done sprint');
    assert.ok(r.unlocked.some((b) => b.key === 'sprint:0'), 'sprint trophy unlocked');
    assert.equal(ov.streak, 0, 'bulk does not fake a streak');

    // undo restores exactly
    await t.call('POST', '/api/bulk/undo', r.undo);
    assert.equal((await t.call('GET', '/api/overview')).data.totals.stepsDone, 0);

    // everything, then reset one sprint
    await t.call('POST', '/api/bulk', { action: 'done', all: true });
    let all = (await t.call('GET', '/api/overview')).data;
    assert.equal(all.totals.stepsDone, all.totals.steps);
    assert.equal(all.player.unlocked > 10, true);
    await t.call('POST', '/api/bulk', { action: 'reset', sprintIds: ['3'] });
    all = (await t.call('GET', '/api/overview')).data;
    assert.equal(all.sprints.find((s) => s.id === '3').done, 0);
    assert.ok(all.totals.stepsDone > 0 && all.totals.stepsDone < all.totals.steps);

    assert.equal((await t.call('POST', '/api/bulk', { action: 'done' })).status, 400);
    assert.equal((await t.call('POST', '/api/bulk', { action: 'nuke', all: true })).status, 400);
  } finally {
    await t.close();
  }
});

test('Done status ticks the steps; legacy Done overrides are migrated; badges unlock once', async () => {
  const t = await start();
  try {
    // ticket status Done -> steps ticked, no override left
    const d = (await t.call('GET', '/api/tickets/S1-T01')).data;
    const total = d.steps.filter((s) => s.kind === 'step' || s.kind === 'verify').length;
    const r = (await t.call('PUT', '/api/tickets/S1-T01/status', { status: 'done' })).data;
    assert.equal(r.steps, total);
    let n = (await t.call('GET', '/api/tickets/S1-T01')).data;
    assert.equal(n.ticket.status, 'done');
    assert.equal(n.ticket.done, total);
    assert.equal(n.ticket.override, null);
    assert.ok(r.unlocked.some((b) => b.key === 'steps:1'), 'first steps badge');
    assert.ok(r.unlocked.some((b) => b.key === 'tickets:1'), 'first ticket badge');
    // second time: nothing new
    assert.deepEqual((await t.call('PUT', '/api/tickets/S1-T01/status', { status: 'done' })).data.unlocked, []);
    // back to todo unticks
    await t.call('PUT', '/api/tickets/S1-T01/status', { status: 'todo' });
    assert.equal((await t.call('GET', '/api/tickets/S1-T01')).data.ticket.done, 0);

    // legacy: an old DB where the ticket is "done" by override only (12 / 778 problem)
    t.db.prepare(`UPDATE tickets SET status_override='done' WHERE id='S1-T02'`).run();
    t.db.prepare(`DELETE FROM meta WHERE key='m_status_done_v2'`).run();
    const { migrateStatusOverrides } = await import('../server/progress.js');
    assert.equal(migrateStatusOverrides(t.db), 1);
    n = (await t.call('GET', '/api/tickets/S1-T02')).data;
    assert.equal(n.ticket.status, 'done');
    assert.equal(n.ticket.done, n.ticket.total);
    assert.equal(migrateStatusOverrides(t.db), 0, 'runs once');

    const a = (await t.call('GET', '/api/achievements')).data;
    assert.equal(a.badges.length, 10);
    assert.ok(a.player.level >= 1 && a.player.xp > 0);
    assert.equal(a.trophies.length, 11);
  } finally {
    await t.close();
  }
});

test('plan API: none yet, preview, save, update, clear, validation', async () => {
  const t = await start();
  try {
    const empty = await t.call('GET', '/api/plan?today=2027-01-04');
    assert.equal(empty.data.plan, null);
    const body = { startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5, perSprint: { 0: 3 }, daysOff: [] };
    const pv = await t.call('POST', '/api/plan/preview?today=2027-01-04', body);
    assert.equal(pv.status, 200);
    assert.equal(pv.data.schedule.sprints.length, 11);
    assert.equal(pv.data.schedule.sprints[0].days, 3);
    assert.equal((await t.call('GET', '/api/plan')).data.plan, null); // preview does not save
    const saved = await t.call('PUT', '/api/plan?today=2027-01-04', body);
    assert.equal(saved.data.plan.sprintDays, 5);
    assert.ok(saved.data.schedule.plannedEnd > '2027-01-04');
    assert.equal((await t.call('GET', '/api/plan?today=2027-01-04')).data.schedule.today.totalSteps, 778);
    assert.equal((await t.call('PUT', '/api/plan', { ...body, workDays: [] })).status, 400);
    await t.call('DELETE', '/api/plan', {});
    assert.equal((await t.call('GET', '/api/plan')).data.plan, null);
  } finally { await t.close(); }
});

test('board statuses: pending keeps steps, test label, auto-done on last step, manual plan overrides', async () => {
  const t = await start();
  try {
    const ov = (await t.call('GET', '/api/overview')).data;
    const tk = ov.sprints.find((s) => s.id === '1').items.find((i) => i.kind === 'ticket' && i.total >= 2);
    const detail = async () => (await t.call('GET', `/api/tickets/${tk.id}`)).data;
    const steps = (await detail()).steps.filter((s) => s.kind === 'step' || s.kind === 'verify');
    await t.call('POST', `/api/steps/${steps[0].id}/done`, { done: true });
    assert.equal((await detail()).ticket.status, 'doing');
    // Pending keeps the ticked step but shows To do
    await t.call('PUT', `/api/tickets/${tk.id}/status`, { status: 'pending' });
    let d = await detail();
    assert.equal(d.ticket.status, 'todo');
    assert.equal(d.ticket.done, 1);
    // ticking another step drops the Pending label
    await t.call('POST', `/api/steps/${steps[1].id}/done`, { done: true });
    assert.notEqual((await detail()).ticket.status, 'todo');
    // Test & fixes label, then finishing the last step moves it to Done by itself
    await t.call('PUT', `/api/tickets/${tk.id}/status`, { status: 'test' });
    assert.equal((await detail()).ticket.status, 'test');
    for (const s of steps) await t.call('POST', `/api/steps/${s.id}/done`, { done: true });
    d = await detail();
    assert.equal(d.ticket.status, 'done');
    assert.equal(d.ticket.override, null);
    // Done drop, then dragging out keeps all steps
    await t.call('PUT', `/api/tickets/${tk.id}/status`, { status: 'blocked' });
    assert.equal((await detail()).ticket.status, 'blocked');

    // plan with a team, manual override, ticket detail shows owner
    const body = { startDate: '2027-01-04', workDays: [1, 2, 3, 4, 5], sprintDays: 5, team: [{ name: 'Ana' }, { name: 'Bob' }] };
    const saved = (await t.call('PUT', '/api/plan?today=2027-01-04', body)).data;
    assert.equal(saved.schedule.team.length, 2);
    const m = await t.call('PUT', '/api/plan/manual?today=2027-01-04', { ticketId: tk.id, member: 'm2', due: '2027-01-20' });
    const row = m.data.schedule.sprints.flatMap((r) => r.schedule).find((x) => x.id === tk.id);
    assert.equal(row.member, 'm2');
    assert.equal(row.due, '2027-01-20');
    assert.equal((await detail()).plan.ticket.member, 'm2');
    // re-saving the form keeps manual overrides
    const re = (await t.call('PUT', '/api/plan?today=2027-01-04', { ...body, sprintDays: 6 })).data;
    assert.equal(re.plan.manual[tk.id].member, 'm2');
    await t.call('PUT', '/api/plan/manual', { ticketId: tk.id, clear: true });
    assert.equal((await t.call('GET', '/api/plan')).data.plan.manual[tk.id], undefined);
    assert.equal((await t.call('PUT', '/api/plan/manual', { ticketId: 'nope' })).status, 404);
  } finally { await t.close(); }
});

test('delivery: ETag/304, br/gzip negotiation, immutable assets, mutation payloads', async () => {
  const s = await start();
  try {
    const raw = (p, headers = {}) => fetch(`http://127.0.0.1:${s.port}${p}`, { headers });
    const ov = await raw('/api/overview', { 'accept-encoding': 'br' });
    assert.equal(ov.headers.get('content-encoding'), 'br');
    assert.match(ov.headers.get('vary') || '', /Accept-Encoding/i);
    const etag = ov.headers.get('etag');
    assert.ok(etag);
    assert.equal((await raw('/api/overview', { 'accept-encoding': 'br', 'if-none-match': etag })).status, 304);
    assert.equal((await raw('/api/overview', { 'accept-encoding': 'gzip' })).headers.get('content-encoding'), 'gzip');
    assert.equal((await raw('/api/overview', { 'accept-encoding': 'identity' })).headers.get('content-encoding'), null);

    const idx = raw('/'); const res = await idx;
    assert.equal(res.status, 200);
    const html = await res.text();
    const asset = html.match(/assets\/[^"]+\.js/)?.[0];
    if (asset) {
      const a = await raw('/' + asset, { 'accept-encoding': 'br' });
      assert.match(a.headers.get('cache-control'), /immutable/);
      assert.equal(a.headers.get('content-encoding'), 'br');
    }
    assert.equal((await raw('/..%2f..%2fpackage.json')).status === 200, false);

    const ov2 = (await s.call('GET', '/api/overview')).data;
    const tid = ov2.sprints.flatMap((x) => x.items).find((i) => i.kind === 'ticket').id;
    const r = await s.call('PUT', `/api/tickets/${tid}/status`, { status: 'done' });
    assert.equal(r.status, 200);
    assert.equal(r.data.ticket.id, tid);
    assert.equal(r.data.ticket.status, 'done');
    assert.ok(r.data.player && typeof r.data.player.xp === 'number');
  } finally { await s.close(); }
});
