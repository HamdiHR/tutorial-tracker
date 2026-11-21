// Hosted-mode tests: the real handler + the real SQL on a local Postgres, behind a fake Supabase.
// Needs psql and a Postgres reachable via PGHOST/PGPORT/PGUSER with the schema loaded (hosted/test/sql-test.sh creates database tt_test). Skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHosted } from '../hosted/handler.js';
import { startFake, psql, SERVICE, ANON } from '../hosted/test/fake-supabase.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pgOk = false;
try { execFileSync('psql', ['-X', '-A', '-t', '-d', 'tt_test', '-c', 'select 1 from tt_profiles limit 1'], { stdio: 'pipe' }); pgOk = true; } catch {}
const t = pgOk ? test : test.skip;

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const tok = (id, email) => `test.${id}.${email}`;

t('hosted: auth, per-person data, first-login choice, invites', async () => {
  psql(`TRUNCATE tt_user_steps, tt_user_tickets, tt_drift, tt_step_versions, tt_activity, tt_badges, tt_meta, tt_profiles, tt_allowed_emails;
        DELETE FROM auth.users;
        INSERT INTO tt_allowed_emails (email, role) VALUES ('a@x.com','owner'), ('b@x.com','member');
        INSERT INTO auth.users (id, email) VALUES ('${A}','A@x.com'), ('${B}','b@x.com');`);
  const fake = await startFake();
  const app = createHosted({ env: { SUPABASE_URL: fake.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE }, contentPath: path.join(ROOT, 'hosted/content.db'), version: 't' });
  const call = async (token, method, url, body = {}) => {
    try { return await app.handle(method, url, token ? { authorization: `Bearer ${token}` } : {}, body); }
    catch (e) { return { status: e.status ?? 500, json: { error: e.message } }; }
  };
  const a = tok(A, 'a@x.com');
  const b = tok(B, 'b@x.com');
  try {
    // public config, then everything else needs a real token
    const cfg = await call(null, 'GET', '/api/config');
    assert.equal(cfg.json.hosted, true); assert.equal(cfg.json.anonKey, ANON);
    assert.equal((await call(null, 'GET', '/api/overview')).status, 401);
    assert.equal((await call('garbage', 'GET', '/api/overview')).status, 401);

    // not yet answered the first-login question
    const me = await call(a, 'GET', '/api/me');
    assert.equal(me.json.role, 'owner'); assert.equal(me.json.onboarded, false);

    // pick a starting ticket in the middle of the tutorial and mark everything before it
    const ov0 = (await call(a, 'GET', '/api/overview')).json;
    assert.equal(ov0.totals.stepsDone, 0);
    const real = ov0.sprints.flatMap((s) => s.items).filter((i) => i.kind === 'ticket' && !i.deferred);
    const at = 40;
    const expected = real.slice(0, at).reduce((n, i) => n + i.total, 0);
    assert.ok(expected > 0);
    assert.equal((await call(a, 'POST', '/api/onboarding', { mode: 'point' })).status, 400); // missing ticket
    const ob = await call(a, 'POST', '/api/onboarding', { mode: 'point', ticketId: real[at].id, markPrevious: true });
    assert.equal(ob.status, 200); assert.equal(ob.json.marked, expected);
    assert.equal((await call(a, 'POST', '/api/onboarding', { mode: 'zero' })).status, 409); // only once
    assert.equal((await call(a, 'GET', '/api/me')).json.onboarded, true);
    const ov1 = (await call(a, 'GET', '/api/overview')).json;
    assert.equal(ov1.totals.stepsDone, expected);
    assert.equal(ov1.current.ticketId, real[at].id);
    assert.equal(ov1.sprints.flatMap((s) => s.items).find((i) => i.id === real[at].id).status, 'todo');
    assert.equal(ov1.sprints.flatMap((s) => s.items).find((i) => i.id === real[at - 1].id).status, 'done');

    // person B is untouched
    assert.equal((await call(b, 'GET', '/api/overview')).json.totals.stepsDone, 0);
    assert.equal((await call(b, 'GET', '/api/me')).json.onboarded, false);
    const zero = await call(b, 'POST', '/api/onboarding', { mode: 'zero' });
    assert.equal(zero.json.marked, 0);

    // normal use persists: tick a step, edit text, add a note, set a status, save a plan
    const detail = (await call(a, 'GET', `/api/tickets/${real[at].id}`)).json;
    const step = detail.steps.find((s) => s.kind === 'step');
    const tick = await call(a, 'POST', `/api/steps/${step.id}/done`, { done: true });
    assert.equal(tick.json.ticket.done, 1); assert.ok(tick.json.player.xp >= 0);
    await call(a, 'PUT', `/api/steps/${step.id}`, { title: 'My title', body: 'My own body\nline 2' });
    await call(a, 'PUT', `/api/steps/${step.id}/note`, { note: 'remember this' });
    await call(a, 'PUT', `/api/tickets/${real[at + 1].id}/status`, { status: 'blocked' });
    const plan = await call(a, 'PUT', '/api/plan', { startDate: '2026-11-02', workDays: [1, 2, 3, 4, 5], sprintDays: 5, team: [{ name: 'Ana' }] });
    assert.equal(plan.status, 200);
    await call(a, 'POST', '/api/resume', { ticketId: real[at].id, stepId: step.id });

    // a brand-new request (new private copy) sees all of it
    const d2 = (await call(a, 'GET', `/api/tickets/${real[at].id}`)).json;
    const s2 = d2.steps.find((s) => s.id === step.id);
    assert.equal(s2.done, 1); assert.equal(s2.title, 'My title'); assert.equal(s2.body, 'My own body\nline 2'); assert.equal(s2.note, 'remember this'); assert.equal(s2.edited, true);
    assert.equal((await call(a, 'GET', '/api/overview')).json.sprints.flatMap((s) => s.items).find((i) => i.id === real[at + 1].id).status, 'blocked');
    assert.equal((await call(a, 'GET', '/api/plan')).json.plan.startDate, '2026-11-02');
    assert.equal((await call(a, 'GET', `/api/steps/${step.id}/versions`)).json.versions.length, 1);
    // and B still sees none of it
    assert.equal((await call(b, 'GET', '/api/plan')).json.plan, null);
    assert.equal((await call(b, 'GET', `/api/tickets/${real[at].id}`)).json.steps.find((s) => s.id === step.id).title === 'My title', false);

    // untick + reset go back to the tutorial text and drop the stored edit
    await call(a, 'POST', `/api/steps/${step.id}/done`, { done: false });
    await call(a, 'POST', `/api/steps/${step.id}/reset`);
    const rows = psql(`SELECT count(*) FROM tt_user_steps WHERE user_id='${A}' AND ticket_id='${real[at].id}' AND step_key='${step.key}' AND (title IS NOT NULL OR body IS NOT NULL)`);
    assert.equal(rows, '0');

    // local-only features are off, and only the owner can invite
    assert.equal((await call(a, 'POST', '/api/import', {})).status, 404);
    assert.equal((await call(b, 'POST', '/api/admin/invite', { email: 'c@x.com' })).status, 403);
    assert.equal((await call(a, 'POST', '/api/admin/invite', { email: 'not-an-email' })).status, 400);
    const inv = await call(a, 'POST', '/api/admin/invite', { email: 'C@x.com' });
    assert.equal(inv.json.emailSent, true); assert.deepEqual(fake.log.invites, ['c@x.com']);
    const people = (await call(a, 'GET', '/api/admin/people')).json.people;
    assert.deepEqual(people.map((p) => [p.email, p.joined]), [['a@x.com', true], ['b@x.com', true], ['c@x.com', false]]);
    assert.equal((await call(a, 'DELETE', '/api/admin/invite', { email: 'b@x.com' })).status, 409);
    assert.equal((await call(a, 'DELETE', '/api/admin/invite', { email: 'c@x.com' })).status, 200);

    // starting over: redo clears progress only
    const redo = await call(a, 'POST', '/api/onboarding', { mode: 'zero', redo: true });
    assert.equal(redo.status, 200);
    assert.equal((await call(a, 'GET', '/api/overview')).json.totals.stepsDone, 0);
  } finally { await fake.close(); }
});
